"""
train.py
────────
랜드마크 CSV 데이터를 읽어 Keras MLP 모델을 학습시키는 스크립트.

[변경] v2 — 양손 126차원 + unknown 클래스
  - 입력: 126차원 (왼손 63 + 오른손 63)
  - 출력: 4클래스 (gojo / megumi / ryomen / unknown)

네트워크 구조:
    Input(126)
    → Dense(128, relu) → Dropout(0.3)
    → Dense(64,  relu) → Dropout(0.3)
    → Dense(4,   softmax)

출력:
    model/models/gesture_model.h5  (학습된 Keras 모델)

사용법:
    python train.py
"""

import os

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from tensorflow import keras
from tensorflow.keras import layers

# ──────────────────────────────────────────────
# 경로 설정
# ──────────────────────────────────────────────

BASE_DIR      = os.path.dirname(__file__)
LANDMARKS_DIR = os.path.join(BASE_DIR, '..', 'data', 'landmarks')
MODELS_DIR    = os.path.join(BASE_DIR, '..', 'models')
OUTPUT_PATH   = os.path.join(MODELS_DIR, 'gesture_model.h5')

# ──────────────────────────────────────────────
# 하이퍼파라미터
# ──────────────────────────────────────────────

CLASSES       = ['gojo', 'ryomen', 'megumi', 'unknown']
NUM_CLASSES   = len(CLASSES)    # 4
INPUT_DIM     = 126             # 양손 21 랜드마크 × (x, y, z) × 2

EPOCHS        = 100             # 최대 학습 에포크 수
BATCH_SIZE    = 32
LEARNING_RATE = 0.001
DROPOUT_RATE  = 0.3
TEST_SIZE     = 0.2             # 전체 데이터 중 검증 세트 비율
RANDOM_SEED   = 42

# EarlyStopping: 검증 손실이 개선되지 않으면 조기 종료
EARLY_STOP_PATIENCE = 15


# ──────────────────────────────────────────────
# 1. 데이터 로드
# ──────────────────────────────────────────────

def load_data():
    """
    각 클래스별 CSV를 읽어 하나의 DataFrame으로 합친 후
    특징 행렬 X와 레이블 벡터 y를 반환.

    반환값:
        X : numpy array, shape (N, 126) — 126차원 랜드마크 벡터 (양손)
        y : numpy array, shape (N,)     — 정수 인코딩된 클래스 레이블
        encoder : LabelEncoder 인스턴스  — 나중에 클래스명 복원에 사용
    """
    dfs = []
    for cls in CLASSES:
        csv_path = os.path.join(LANDMARKS_DIR, f'{cls}.csv')
        if not os.path.exists(csv_path):
            print(f"[경고] CSV 없음 — 건너뜀: {csv_path}")
            continue
        # header=None: CSV에 헤더 행이 없음
        # 컬럼 구조: [0~125] 특징값(126차원) + [126] 레이블 문자열
        df = pd.read_csv(csv_path, header=None)

        # 첫 번째 행이 실수값인지 확인해 헤더 행을 잘못 읽은 경우를 걸러냄
        # (헤더가 있는 CSV를 header=None으로 읽으면 첫 행에 'lx0' 같은 문자열이 들어옴)
        try:
            float(df.iloc[0, 0])
        except (ValueError, TypeError):
            # 첫 행이 헤더 — header=0으로 다시 읽기
            df = pd.read_csv(csv_path, header=0)
            # 'label' 컬럼 제외한 나머지를 숫자 인덱스로 재매핑
            df.columns = list(range(len(df.columns) - 1)) + ['label']
        else:
            # 헤더 없는 경우: 마지막 열(126)을 'label'로 이름 지정
            df.columns = list(range(INPUT_DIM)) + ['label']

        dfs.append(df)
        print(f"  [{cls}] {len(df):5d}개 로드 완료")

    if not dfs:
        raise FileNotFoundError(
            "학습 데이터가 없습니다. collect_data.py 또는 "
            "extract_landmarks.py를 먼저 실행하세요."
        )

    data = pd.concat(dfs, ignore_index=True)
    data = data.sample(frac=1, random_state=RANDOM_SEED)  # 셔플

    # 특징(0~INPUT_DIM-1)과 레이블('label') 분리
    feature_cols = list(range(INPUT_DIM))
    X = data[feature_cols].values.astype(np.float32)

    # 문자열 레이블 → 정수 인코딩 (알파벳 순: gojo=0, megumi=1, ryomen=2, unknown=3)
    encoder = LabelEncoder()
    y = encoder.fit_transform(data['label'].values)

    print(f"\n전체 샘플: {len(X)}개  /  클래스: {list(encoder.classes_)}")
    return X, y, encoder


# ──────────────────────────────────────────────
# 2. 모델 정의
# ──────────────────────────────────────────────

def build_model():
    """
    MLP 모델 생성.

    구조: Input(126) → Dense(128) → Dropout → Dense(64) → Dropout → Dense(4)
    """
    model = keras.Sequential([
        # 입력층: 126차원 랜드마크 벡터 (양손 합산)
        layers.Input(shape=(INPUT_DIM,)),

        # 은닉층 1: 128 유닛, ReLU 활성화
        layers.Dense(128, activation='relu'),
        layers.Dropout(DROPOUT_RATE),   # 과적합 방지

        # 은닉층 2: 64 유닛, ReLU 활성화
        layers.Dense(64, activation='relu'),
        layers.Dropout(DROPOUT_RATE),

        # 출력층: 4개 클래스 확률값 (gojo / megumi / ryomen / unknown)
        layers.Dense(NUM_CLASSES, activation='softmax'),
    ], name='gesture_mlp')

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=LEARNING_RATE),
        loss='sparse_categorical_crossentropy',  # 정수 레이블에 적합
        metrics=['accuracy'],
    )
    return model


# ──────────────────────────────────────────────
# 3. 학습 곡선 시각화
# ──────────────────────────────────────────────

def plot_history(history):
    """
    학습 / 검증 정확도 및 손실 곡선을 PNG로 저장.
    학습 경향을 시각적으로 파악해 과적합 여부를 확인할 수 있음.
    """
    fig, axes = plt.subplots(1, 2, figsize=(12, 4))

    # ── 정확도 그래프 ──
    axes[0].plot(history.history['accuracy'],     label='학습')
    axes[0].plot(history.history['val_accuracy'], label='검증')
    axes[0].set_title('정확도 (Accuracy)')
    axes[0].set_xlabel('Epoch')
    axes[0].set_ylabel('Accuracy')
    axes[0].legend()
    axes[0].grid(True)

    # ── 손실 그래프 ──
    axes[1].plot(history.history['loss'],     label='학습')
    axes[1].plot(history.history['val_loss'], label='검증')
    axes[1].set_title('손실 (Loss)')
    axes[1].set_xlabel('Epoch')
    axes[1].set_ylabel('Loss')
    axes[1].legend()
    axes[1].grid(True)

    plt.tight_layout()
    plot_path = os.path.join(MODELS_DIR, 'training_history.png')
    plt.savefig(plot_path, dpi=100)
    plt.close()
    print(f"학습 곡선 저장: {plot_path}")


# ──────────────────────────────────────────────
# 4. 메인 실행
# ──────────────────────────────────────────────

def main():
    os.makedirs(MODELS_DIR, exist_ok=True)

    # 데이터 로드
    print("=== 데이터 로드 ===")
    X, y, encoder = load_data()

    # 학습 / 검증 분할 (stratify: 클래스 비율 유지)
    X_train, X_val, y_train, y_val = train_test_split(
        X, y,
        test_size=TEST_SIZE,
        random_state=RANDOM_SEED,
        stratify=y,
    )
    print(f"학습: {len(X_train)}개  /  검증: {len(X_val)}개\n")

    # 모델 생성 및 구조 출력
    print("=== 모델 구조 ===")
    model = build_model()
    model.summary()

    # 콜백 설정
    callbacks = [
        # 검증 손실 기준 최적 가중치 저장
        keras.callbacks.ModelCheckpoint(
            filepath=OUTPUT_PATH,
            monitor='val_loss',
            save_best_only=True,
            verbose=1,
        ),
        # 검증 손실이 EARLY_STOP_PATIENCE 에포크 동안 개선 없으면 조기 종료
        keras.callbacks.EarlyStopping(
            monitor='val_loss',
            patience=EARLY_STOP_PATIENCE,
            restore_best_weights=True,
            verbose=1,
        ),
        # 학습 진행 상황을 에포크별로 출력
        keras.callbacks.ReduceLROnPlateau(
            monitor='val_loss',
            factor=0.5,        # 학습률을 절반으로 감소
            patience=7,
            verbose=1,
        ),
    ]

    # 모델 학습
    print("\n=== 학습 시작 ===")
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        verbose=1,
    )

    # 최종 검증 정확도 출력
    val_loss, val_acc = model.evaluate(X_val, y_val, verbose=0)
    print(f"\n=== 최종 검증 성능 ===")
    print(f"  손실 (Loss)    : {val_loss:.4f}")
    print(f"  정확도 (Acc)   : {val_acc * 100:.2f}%")
    print(f"  모델 저장 경로 : {OUTPUT_PATH}")

    # 학습 곡선 시각화
    plot_history(history)

    # 클래스 인덱스 매핑 출력 (TF.js 연동 시 필요)
    print("\n=== 클래스 인덱스 매핑 (TF.js에서 사용) ===")
    for idx, cls in enumerate(encoder.classes_):
        print(f"  {idx} : {cls}")


if __name__ == '__main__':
    main()

"""
convert_to_tfjs.py
──────────────────
학습된 Keras .h5 모델을 TensorFlow.js(TFJS) 포맷으로 변환하고
웹 프로젝트 public 폴더에 복사하는 스크립트.

변환 결과:
    model/models/tfjs_model/
        ├── model.json        ← 네트워크 구조 정의
        └── group1-shard1of1.bin  ← 가중치(Weight) 바이너리

복사 대상:
    web/public/tfjs_model/  ← Vite 개발 서버·배포에서 직접 제공

사용법:
    python convert_to_tfjs.py
"""

import os
import shutil

import tensorflowjs as tfjs

# ──────────────────────────────────────────────
# 경로 설정
# ──────────────────────────────────────────────

BASE_DIR      = os.path.dirname(__file__)
PROJECT_ROOT  = os.path.abspath(os.path.join(BASE_DIR, '..', '..'))

# 학습된 Keras 모델 경로
H5_PATH       = os.path.join(BASE_DIR, '..', 'models', 'gesture_model.h5')

# TFJS 변환 결과 저장 경로
TFJS_OUT_DIR  = os.path.join(BASE_DIR, '..', 'models', 'tfjs_model')

# 웹 프로젝트에 복사할 경로
WEB_MODEL_DIR = os.path.join(PROJECT_ROOT, 'web', 'public', 'tfjs_model')


def convert():
    """
    .h5 모델을 TF.js LayersModel 포맷으로 변환.

    변환 방식: 'tfjs_layers_model'
    → TF.js의 tf.loadLayersModel() API로 직접 로드 가능
    """
    # 입력 파일 존재 확인
    if not os.path.exists(H5_PATH):
        raise FileNotFoundError(
            f"Keras 모델 파일을 찾을 수 없습니다: {H5_PATH}\n"
            "train.py를 먼저 실행하세요."
        )

    # 출력 디렉터리 준비 (재변환 시 기존 파일 삭제)
    if os.path.exists(TFJS_OUT_DIR):
        shutil.rmtree(TFJS_OUT_DIR)
    os.makedirs(TFJS_OUT_DIR, exist_ok=True)

    print(f"변환 중: {H5_PATH}")
    print(f"  → {TFJS_OUT_DIR}")

    # tensorflowjs_converter와 동일한 변환을 Python API로 실행
    tfjs.converters.save_keras_model(
        model=__load_keras_model(H5_PATH),
        artifacts_dir=TFJS_OUT_DIR,
    )

    print("변환 완료!")


def __load_keras_model(h5_path):
    """
    .h5 파일에서 Keras 모델을 로드.
    tensorflow import는 변환 시에만 필요하므로 지연 임포트.
    """
    from tensorflow import keras
    model = keras.models.load_model(h5_path)
    model.summary()
    return model


def copy_to_web():
    """
    변환된 TFJS 모델 파일들을 web/public/tfjs_model/ 에 복사.
    Vite 개발 서버는 public/ 폴더를 정적 파일로 제공하므로
    브라우저에서 /tfjs_model/model.json 으로 바로 접근 가능.
    """
    if not os.path.exists(TFJS_OUT_DIR):
        raise RuntimeError("TFJS 모델이 없습니다. convert()를 먼저 실행하세요.")

    # 기존 모델 삭제 후 복사
    if os.path.exists(WEB_MODEL_DIR):
        shutil.rmtree(WEB_MODEL_DIR)

    shutil.copytree(TFJS_OUT_DIR, WEB_MODEL_DIR)
    print(f"\n웹 복사 완료: {WEB_MODEL_DIR}")

    # 복사된 파일 목록 출력
    for fname in os.listdir(WEB_MODEL_DIR):
        fsize = os.path.getsize(os.path.join(WEB_MODEL_DIR, fname))
        print(f"  {fname}  ({fsize / 1024:.1f} KB)")


def main():
    print("=== Keras → TensorFlow.js 변환 ===\n")
    convert()
    copy_to_web()

    print("\n=== 완료 ===")
    print("이제 web/src/core/GestureModel.js에서 모델을 로드할 수 있습니다.")
    print("  tf.loadLayersModel('/tfjs_model/model.json')")


if __name__ == '__main__':
    main()

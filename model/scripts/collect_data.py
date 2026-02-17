"""
collect_data.py
───────────────
웹캠으로 클래스별 손동작 데이터를 수집하는 스크립트.
mediapipe 0.10.14+ 의 새 Tasks API(HandLandmarker) 사용.

사용법:
    python scripts/collect_data.py

키 조작:
    1~3       : 클래스 전환 (gojo / ryomen / megumi)
    스페이스바 : 수집 시작 / 중지
    q          : 종료

출력:
    model/data/landmarks/{클래스명}.csv
"""

import csv
import os
import time
import urllib.request

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision as mp_vision

# ──────────────────────────────────────────────
# 설정 상수
# ──────────────────────────────────────────────

CLASSES = ['gojo', 'ryomen', 'megumi']

BASE_DIR       = os.path.dirname(__file__)
LANDMARKS_DIR  = os.path.join(BASE_DIR, '..', 'data', 'landmarks')
MODELS_DIR     = os.path.join(BASE_DIR, '..', 'models')

# HandLandmarker 모델 파일 경로
# MediaPipe C++ 내부는 비ASCII 경로를 처리하지 못하므로
# 한글 경로(사용자명 등)를 피해 C:\Temp 에 저장한다.
HAND_MODEL_PATH = r'C:\Temp\hand_landmarker.task'
HAND_MODEL_URL  = (
    'https://storage.googleapis.com/mediapipe-models/'
    'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
)

DETECTION_CONFIDENCE = 0.7
TRACKING_CONFIDENCE  = 0.5

# 스페이스바를 누른 뒤 실제 수집 시작까지의 준비 시간 (초)
COUNTDOWN_SEC = 2

# ──────────────────────────────────────────────
# 모델 파일 다운로드 (없을 경우에만)
# ──────────────────────────────────────────────

def ensure_model():
    """HandLandmarker .task 파일이 없으면 자동 다운로드한다."""
    os.makedirs(MODELS_DIR, exist_ok=True)
    if not os.path.exists(HAND_MODEL_PATH):
        print(f"HandLandmarker 모델 다운로드 중...")
        print(f"  → {HAND_MODEL_PATH}")
        urllib.request.urlretrieve(HAND_MODEL_URL, HAND_MODEL_PATH)
        print("  다운로드 완료!")

# ──────────────────────────────────────────────
# 랜드마크 시각화 (직접 구현 — solutions.drawing_utils 대체)
# ──────────────────────────────────────────────

# MediaPipe 손 연결 정보 (21개 랜드마크 간 선 연결 인덱스 쌍)
HAND_CONNECTIONS = [
    (0,1),(1,2),(2,3),(3,4),       # 엄지
    (0,5),(5,6),(6,7),(7,8),       # 검지
    (0,9),(9,10),(10,11),(11,12),  # 중지
    (0,13),(13,14),(14,15),(15,16),# 약지
    (0,17),(17,18),(18,19),(19,20),# 소지
    (5,9),(9,13),(13,17),          # 손바닥 가로 연결
]

def draw_hand(frame, landmarks_list, img_w, img_h):
    """
    손 랜드마크와 스켈레톤 선을 프레임에 직접 그린다.
    landmarks_list: mediapipe NormalizedLandmark 목록 (21개)
    """
    # 픽셀 좌표로 변환 (정규화 좌표 0~1 → 픽셀)
    points = [
        (int(lm.x * img_w), int(lm.y * img_h))
        for lm in landmarks_list
    ]

    # 연결선 그리기
    for start_idx, end_idx in HAND_CONNECTIONS:
        cv2.line(frame, points[start_idx], points[end_idx],
                 (0, 200, 100), 2)

    # 랜드마크 점 그리기
    for px, py in points:
        cv2.circle(frame, (px, py), 5, (0, 255, 128), -1)
        cv2.circle(frame, (px, py), 5, (255, 255, 255), 1)  # 흰 테두리

# ──────────────────────────────────────────────
# 메인
# ──────────────────────────────────────────────

def main():
    ensure_model()
    os.makedirs(LANDMARKS_DIR, exist_ok=True)

    # ── CSV 파일 핸들러 준비 ──
    csv_files   = {}
    csv_writers = {}
    for cls in CLASSES:
        filepath    = os.path.join(LANDMARKS_DIR, f'{cls}.csv')
        file_exists = os.path.exists(filepath)
        f      = open(filepath, 'a', newline='', encoding='utf-8')
        writer = csv.writer(f)
        if not file_exists:
            header = []
            for i in range(21):
                header += [f'x{i}', f'y{i}', f'z{i}']
            header.append('label')
            writer.writerow(header)
        csv_files[cls]   = f
        csv_writers[cls] = writer

    # ── HandLandmarker 초기화 (IMAGE 모드: 프레임 단위 처리) ──
    base_options = mp_tasks.BaseOptions(model_asset_path=HAND_MODEL_PATH)
    options = mp_vision.HandLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.IMAGE,
        num_hands=2,
        min_hand_detection_confidence=DETECTION_CONFIDENCE,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=TRACKING_CONFIDENCE,
    )
    landmarker = mp_vision.HandLandmarker.create_from_options(options)

    # ── 상태 변수 ──
    current_class_idx = 0
    collecting        = False
    # 카운트다운 시작 시각 (None이면 카운트다운 비활성)
    countdown_start   = None
    collected_counts  = {cls: 0 for cls in CLASSES}

    cap = cv2.VideoCapture(0)
    print("=== 손동작 데이터 수집 도구 ===")
    print(f"클래스 전환 : 1~{len(CLASSES)} 키  ({', '.join(CLASSES)})")
    print("수집 시작/중지 : 스페이스바")
    print("종료 : q\n")

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        # 좌우 반전 (거울 모드)
        frame    = cv2.flip(frame, 1)
        img_h, img_w = frame.shape[:2]

        # BGR → RGB 변환 후 MediaPipe 이미지로 래핑
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image  = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        # 손 랜드마크 감지
        result = landmarker.detect(mp_image)

        # ── 카운트다운 경과 확인: COUNTDOWN_SEC 이 지나면 수집 시작 ──
        if countdown_start is not None and not collecting:
            elapsed = time.time() - countdown_start
            if elapsed >= COUNTDOWN_SEC:
                # 카운트다운 완료 → 수집 전환
                collecting      = True
                countdown_start = None
                print(f"[{CLASSES[current_class_idx]}] 수집 시작")

        # ── 감지된 손 처리 ──
        if result.hand_landmarks:
            for hand_lms in result.hand_landmarks:
                # 스켈레톤 시각화
                draw_hand(frame, hand_lms, img_w, img_h)

                # 수집 모드일 때 CSV 저장
                if collecting:
                    # 손목(landmark[0]) 기준 상대 좌표로 정규화
                    wrist = hand_lms[0]
                    row   = []
                    for lm in hand_lms:
                        row += [
                            round(lm.x - wrist.x, 6),
                            round(lm.y - wrist.y, 6),
                            round(lm.z - wrist.z, 6),
                        ]
                    row.append(CLASSES[current_class_idx])
                    csv_writers[CLASSES[current_class_idx]].writerow(row)
                    csv_files[CLASSES[current_class_idx]].flush()
                    collected_counts[CLASSES[current_class_idx]] += 1

        # ── HUD 렌더링 ──
        current_class = CLASSES[current_class_idx]

        if collecting:
            # 수집 중: 초록색
            color       = (0, 255, 0)
            status_text = "● 수집 중..."
        elif countdown_start is not None:
            # 카운트다운 중: 남은 시간을 계산해 주황색으로 표시
            remaining   = COUNTDOWN_SEC - (time.time() - countdown_start)
            color       = (0, 165, 255)
            status_text = f"준비 중... {remaining:.1f}초"
        else:
            # 대기 중: 빨간색
            color       = (0, 80, 255)
            status_text = "■ 대기 (Space: 시작)"

        cv2.putText(frame, f"Class : {current_class}", (10, 38),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.1, color, 2)
        cv2.putText(frame, status_text, (10, 78),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.75, color, 2)
        cv2.putText(frame, f"Count : {collected_counts[current_class]}", (10, 118),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 220, 0), 2)

        # 좌측 하단에 전체 클래스 현황 표시
        for i, cls in enumerate(CLASSES):
            y_pos = img_h - 20 - i * 26
            cv2.putText(frame, f"{cls}: {collected_counts[cls]}",
                        (10, y_pos), cv2.FONT_HERSHEY_SIMPLEX,
                        0.55, (180, 180, 180), 1)

        cv2.imshow('Ryoiki-Tenkai — 데이터 수집', frame)

        # ── 키 입력 ──
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord(' '):
            if collecting:
                # 수집 중 → 즉시 중지
                collecting = False
                print(f"[{current_class}] 중지 → 누적 {collected_counts[current_class]}개")
            elif countdown_start is not None:
                # 카운트다운 중 → 취소
                countdown_start = None
                print(f"[{current_class}] 카운트다운 취소")
            else:
                # 대기 중 → 카운트다운 시작 (COUNTDOWN_SEC 후 수집 시작)
                countdown_start = time.time()
                print(f"[{current_class}] {COUNTDOWN_SEC}초 후 수집 시작...")
        elif ord('1') <= key <= ord('3'):
            new_idx = key - ord('1')
            if new_idx < len(CLASSES):
                current_class_idx = new_idx
                collecting        = False
                countdown_start   = None  # 클래스 전환 시 카운트다운도 취소
                print(f"클래스 전환 → {CLASSES[current_class_idx]}")

    # ── 정리 ──
    cap.release()
    cv2.destroyAllWindows()
    landmarker.close()
    for f in csv_files.values():
        f.close()

    print("\n=== 수집 완료 ===")
    for cls in CLASSES:
        print(f"  {cls:10s}: {collected_counts[cls]:5d}개")


if __name__ == '__main__':
    main()

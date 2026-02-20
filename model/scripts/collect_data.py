"""
collect_data.py
───────────────
웹캠으로 클래스별 손동작 데이터를 수집하는 스크립트.
mediapipe 0.10.14+ 의 새 Tasks API(HandLandmarker) 사용.

[변경] v2 — 양손 126차원 + unknown 클래스
  - 양손 랜드마크를 handedness 기준으로 [Left 63차원 | Right 63차원]으로 저장.
  - 한 손이 감지되지 않으면 해당 63차원을 0으로 패딩.
  - unknown 클래스 추가: 제스처에 해당하지 않는 일반 손 자세 수집.

사용법:
    python scripts/collect_data.py

키 조작:
    1 : gojo
    2 : ryomen
    3 : megumi
    4 : unknown (아무 손 자세나)
    스페이스바 : 수집 시작 / 중지
    q          : 종료

출력:
    model/data/landmarks/{클래스명}.csv
    CSV 컬럼: lx0,ly0,lz0,...,lx20,ly20,lz20 (왼손 63) +
              rx0,ry0,rz0,...,rx20,ry20,rz20 (오른손 63) + label
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

# unknown 클래스 추가: 아무 포즈에도 해당하지 않음을 학습시키기 위한 더미 클래스
CLASSES = ['gojo', 'ryomen', 'megumi', 'unknown']

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

# 임계값을 낮춰 측면 손·양손 등 어려운 각도에서도 감지율을 높인다.
# 너무 낮추면 오감지가 증가하므로 0.4~0.5 범위를 권장.
DETECTION_CONFIDENCE  = 0.5
PRESENCE_CONFIDENCE   = 0.4   # 손이 프레임에 존재하는지 판단 임계값
TRACKING_CONFIDENCE   = 0.4

# 스페이스바를 누른 뒤 실제 수집 시작까지의 준비 시간 (초)
COUNTDOWN_SEC = 2

# 클래스별 필요 손 개수
#   1 = 한 손만 (고죠: 한 손 제스처)
#   2 = 양손 필수 (료멘·메구미: 양손 제스처)
#   0 = 제한 없음 (unknown: 어떤 상황이든 수집)
CLASS_HAND_COUNT = {
    'gojo':    1,
    'ryomen':  2,
    'megumi':  2,
    'unknown': 0,
}

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

def draw_hand(frame, landmarks_list, img_w, img_h, color=(0, 200, 100)):
    """
    손 랜드마크와 스켈레톤 선을 프레임에 직접 그린다.
    landmarks_list: mediapipe NormalizedLandmark 목록 (21개)
    color: 스켈레톤 색상 (왼손/오른손 구분용)
    """
    # 픽셀 좌표로 변환 (정규화 좌표 0~1 → 픽셀)
    points = [
        (int(lm.x * img_w), int(lm.y * img_h))
        for lm in landmarks_list
    ]

    # 연결선 그리기
    for start_idx, end_idx in HAND_CONNECTIONS:
        cv2.line(frame, points[start_idx], points[end_idx], color, 2)

    # 랜드마크 점 그리기
    for px, py in points:
        cv2.circle(frame, (px, py), 5, color, -1)
        cv2.circle(frame, (px, py), 5, (255, 255, 255), 1)  # 흰 테두리

# ──────────────────────────────────────────────
# 랜드마크 정규화: 손목 기준 상대 좌표 63차원
# ──────────────────────────────────────────────

def normalize_landmarks(hand_lms):
    """
    손목(landmark[0])을 원점으로 삼아 21개 랜드마크의 상대 좌표를
    63차원 float 리스트로 반환한다.
    JS의 HandTracker.normalizeLandmarks()와 동일한 방식.
    """
    wrist = hand_lms[0]
    coords = []
    for lm in hand_lms:
        coords += [
            round(lm.x - wrist.x, 6),
            round(lm.y - wrist.y, 6),
            round(lm.z - wrist.z, 6),
        ]
    return coords  # 길이 63

# ──────────────────────────────────────────────
# 메인
# ──────────────────────────────────────────────

def main():
    ensure_model()
    os.makedirs(LANDMARKS_DIR, exist_ok=True)

    # ── CSV 파일 핸들러 준비 ──
    # 컬럼 구조: lx0,ly0,lz0,...,lx20,ly20,lz20 (왼손 63) +
    #           rx0,ry0,rz0,...,rx20,ry20,rz20 (오른손 63) + label
    csv_files   = {}
    csv_writers = {}
    for cls in CLASSES:
        filepath    = os.path.join(LANDMARKS_DIR, f'{cls}.csv')
        file_exists = os.path.exists(filepath)
        f      = open(filepath, 'a', newline='', encoding='utf-8')
        writer = csv.writer(f)
        if not file_exists:
            # 126차원 헤더 생성
            header = []
            for i in range(21):
                header += [f'lx{i}', f'ly{i}', f'lz{i}']  # 왼손
            for i in range(21):
                header += [f'rx{i}', f'ry{i}', f'rz{i}']  # 오른손
            header.append('label')
            writer.writerow(header)
        csv_files[cls]   = f
        csv_writers[cls] = writer

    # ── HandLandmarker 초기화 (VIDEO 모드: 타임스탬프 기반 시계열 추적) ──
    # IMAGE 모드는 매 프레임을 독립 처리해 시간적 연속성이 없다.
    # VIDEO 모드는 이전 프레임 정보를 누적해 양손·측면 등 어려운 각도의
    # 감지율과 추적 안정성이 크게 향상된다.
    base_options = mp_tasks.BaseOptions(model_asset_path=HAND_MODEL_PATH)
    options = mp_vision.HandLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.VIDEO,       # IMAGE → VIDEO로 변경
        num_hands=2,                                    # 양손 감지
        min_hand_detection_confidence=DETECTION_CONFIDENCE,
        min_hand_presence_confidence=PRESENCE_CONFIDENCE,
        min_tracking_confidence=TRACKING_CONFIDENCE,
    )
    landmarker = mp_vision.HandLandmarker.create_from_options(options)

    # VIDEO 모드에서 필요한 단조 증가 타임스탬프 (밀리초)
    frame_timestamp_ms = 0

    # ── 상태 변수 ──
    current_class_idx = 0
    collecting        = False
    countdown_start   = None   # 카운트다운 시작 시각 (None이면 비활성)
    collected_counts  = {cls: 0 for cls in CLASSES}

    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)  # 너비 1280으로 증가
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)  # 높이 720으로 증가
    print("=== 손동작 데이터 수집 도구 (양손 126차원) ===")
    print(f"클래스 전환 : 1~{len(CLASSES)} 키  ({', '.join(CLASSES)})")
    print("수집 시작/중지 : 스페이스바")
    print("종료 : q")
    print("─" * 40)
    print("※ 클래스별 손 개수 규칙:")
    print("   gojo   (1): 한 손만 보이게 하세요.")
    print("   ryomen (2): 양손이 모두 보여야 저장됩니다.")
    print("   megumi (2): 양손이 모두 보여야 저장됩니다.")
    print("   unknown(0): 손 개수 제한 없음. 다양한 자세를 섞어 수집하세요.")
    print("─" * 40 + "\n")

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        img_h, img_w = frame.shape[:2]

        # BGR → RGB 변환 후 MediaPipe 이미지로 래핑
        # [주의] 원본(반전 전) 프레임을 MediaPipe에 전달해야 handedness가 정확하다.
        # 이미지를 먼저 flip하면 손의 엄지 방향도 반전되어 MediaPipe가
        # 해부학적으로 반대 손으로 판별한다. (물리적 오른손 → "Left" 오판별)
        # JS HandTracker.js 역시 raw 비디오를 그대로 MediaPipe에 전달하므로
        # 여기서도 동일하게 원본 프레임을 사용해 Left/Right 슬롯을 일치시킨다.
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image  = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        # VIDEO 모드: detect_for_video()에 단조 증가 타임스탬프를 전달해야 한다.
        # time.time() 대신 증분 카운터를 사용하면 시스템 시간 역전 문제를 방지한다.
        frame_timestamp_ms += 33          # ~30fps 기준 약 33ms 증분
        result = landmarker.detect_for_video(mp_image, frame_timestamp_ms)

        # ── 카운트다운 경과 확인: COUNTDOWN_SEC 이 지나면 수집 시작 ──
        if countdown_start is not None and not collecting:
            elapsed = time.time() - countdown_start
            if elapsed >= COUNTDOWN_SEC:
                collecting      = True
                countdown_start = None
                print(f"[{CLASSES[current_class_idx]}] 수집 시작")

        # ── 양손 랜드마크를 handedness 기준으로 분류 ──
        # 원본(반전 전) 프레임을 사용했으므로 MediaPipe handedness가 실제 손과 일치한다.
        # 물리적 왼손 → "Left"(0~62), 물리적 오른손 → "Right"(63~125).
        # JS HandTracker.normalizeBothHands()와 동일한 [Left 63 | Right 63] 슬롯 구조.
        # 감지되지 않은 손은 0으로 패딩 (모델이 이 케이스도 학습해야 함).
        left_coords  = [0.0] * 63  # 왼손 미감지 시 패딩
        right_coords = [0.0] * 63  # 오른손 미감지 시 패딩

        if result.hand_landmarks:
            for hand_lms, handedness_list in zip(result.hand_landmarks, result.handedness):
                # handedness_list[0].category_name: "Left" 또는 "Right"
                side   = handedness_list[0].category_name
                coords = normalize_landmarks(hand_lms)

                # 왼손/오른손 색상 구분 (시각화)
                color = (255, 100, 0) if side == 'Left' else (0, 100, 255)
                draw_hand(frame, hand_lms, img_w, img_h, color=color)

                if side == 'Left':
                    left_coords = coords
                else:
                    right_coords = coords

        # ── 현재 감지된 손 개수 계산 ──
        detected_hand_count = (
            (1 if any(v != 0.0 for v in left_coords)  else 0) +
            (1 if any(v != 0.0 for v in right_coords) else 0)
        )

        # ── 클래스별 손 개수 검증 ──
        # required == 0 이면 제한 없음 (unknown 등)
        cls_name     = CLASSES[current_class_idx]
        required     = CLASS_HAND_COUNT[cls_name]
        hand_ok      = (required == 0) or (detected_hand_count == required)

        # ── 수집 모드일 때 CSV 저장 (손 개수가 맞을 때만) ──
        if collecting and hand_ok:
            # 126차원 = [왼손 63 | 오른손 63] + 레이블
            row = left_coords + right_coords + [cls_name]
            csv_writers[cls_name].writerow(row)
            csv_files[cls_name].flush()
            collected_counts[cls_name] += 1

        # ── 표시용 거울 반전 (원본 프레임에 스켈레톤을 그린 뒤 flip) ──
        # 원본 프레임에 랜드마크를 그리고 나서 flip하면 스켈레톤 좌표도
        # 자연스럽게 거울 모드에 맞게 반전되어 표시된다.
        frame = cv2.flip(frame, 1)

        # ── HUD 렌더링 ──
        current_class = CLASSES[current_class_idx]

        if collecting:
            color_hud   = (0, 255, 0)
            status_text = "● 수집 중..."
        elif countdown_start is not None:
            remaining   = COUNTDOWN_SEC - (time.time() - countdown_start)
            color_hud   = (0, 165, 255)
            status_text = f"준비 중... {remaining:.1f}초"
        else:
            color_hud   = (0, 80, 255)
            status_text = "■ 대기 (Space: 시작)"

        cv2.putText(frame, f"Class : {current_class}", (10, 38),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.1, color_hud, 2)
        cv2.putText(frame, status_text, (10, 78),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.75, color_hud, 2)
        cv2.putText(frame, f"Count : {collected_counts[current_class]}", (10, 118),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 220, 0), 2)

        # 손 감지 상태 표시 + 손 개수 검증 결과
        left_status  = "L:O" if any(v != 0.0 for v in left_coords)  else "L:X"
        right_status = "R:O" if any(v != 0.0 for v in right_coords) else "R:X"

        if required == 0:
            # unknown: 제한 없음
            hand_guide = f"{left_status} {right_status} (제한없음)"
            hand_color = (200, 200, 200)
        elif hand_ok:
            # 손 개수 일치
            hand_guide = f"{left_status} {right_status} (OK: {detected_hand_count}/{required}손)"
            hand_color = (0, 255, 0)
        else:
            # 손 개수 불일치 → 저장 안 됨
            hand_guide = f"{left_status} {right_status} ({detected_hand_count}/{required}손 필요)"
            hand_color = (0, 60, 255)

        cv2.putText(frame, hand_guide, (10, 148),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, hand_color, 1)

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
                collecting = False
                print(f"[{current_class}] 중지 → 누적 {collected_counts[current_class]}개")
            elif countdown_start is not None:
                countdown_start = None
                print(f"[{current_class}] 카운트다운 취소")
            else:
                countdown_start = time.time()
                print(f"[{current_class}] {COUNTDOWN_SEC}초 후 수집 시작...")
        elif ord('1') <= key <= ord('4'):
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

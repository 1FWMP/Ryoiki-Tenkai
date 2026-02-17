"""
extract_landmarks.py
────────────────────
model/data/raw/ 디렉터리의 영상·이미지 파일에서
MediaPipe로 손 랜드마크를 추출하여 CSV에 저장하는 스크립트.

사용법:
    python extract_landmarks.py

디렉터리 규칙:
    model/data/raw/{클래스명}/  →  gojo/, ryomen/, megumi/
    각 폴더 안에 .jpg/.png/.mp4/.avi 파일을 넣으면 됨

출력:
    model/data/landmarks/{클래스명}.csv
"""

import csv
import os

import cv2
import mediapipe as mp
import numpy as np

# ──────────────────────────────────────────────
# 설정 상수
# ──────────────────────────────────────────────

# 인식할 클래스 목록 (raw/ 하위 폴더 이름과 일치해야 함)
CLASSES = ['gojo', 'ryomen', 'megumi']

# 경로 설정
BASE_DIR       = os.path.dirname(__file__)
RAW_DIR        = os.path.join(BASE_DIR, '..', 'data', 'raw')
LANDMARKS_DIR  = os.path.join(BASE_DIR, '..', 'data', 'landmarks')

# 지원하는 파일 확장자
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.bmp'}
VIDEO_EXTS = {'.mp4', '.avi', '.mov', '.mkv'}

# MediaPipe 감지 신뢰도
DETECTION_CONFIDENCE = 0.7

# ──────────────────────────────────────────────
# 헬퍼 함수
# ──────────────────────────────────────────────

def normalize_landmarks(hand_landmarks):
    """
    손목(landmark[0])을 원점으로 하는 상대 좌표 63차원 벡터를 반환.
    손의 절대 위치·크기에 무관한 특징 벡터를 만들기 위한 전처리.

    반환값:
        list[float]: 길이 63 (21 랜드마크 × x, y, z)
    """
    wrist  = hand_landmarks.landmark[0]
    vector = []
    for lm in hand_landmarks.landmark:
        vector += [
            round(lm.x - wrist.x, 6),
            round(lm.y - wrist.y, 6),
            round(lm.z - wrist.z, 6),
        ]
    return vector


def process_frame(frame, hands_detector):
    """
    단일 프레임에서 손 랜드마크를 추출하여 정규화된 벡터 목록을 반환.

    인자:
        frame           : BGR 이미지 (numpy array)
        hands_detector  : mediapipe Hands 인스턴스

    반환값:
        list[list[float]]: 감지된 손 개수만큼의 63차원 벡터 목록
                           손이 감지되지 않으면 빈 리스트 반환
    """
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = hands_detector.process(rgb)

    vectors = []
    if results.multi_hand_landmarks:
        for hand_lm in results.multi_hand_landmarks:
            vectors.append(normalize_landmarks(hand_lm))
    return vectors


def build_csv_header():
    """63차원 벡터 + 레이블 헤더 리스트 생성."""
    header = []
    for i in range(21):
        header += [f'x{i}', f'y{i}', f'z{i}']
    header.append('label')
    return header

# ──────────────────────────────────────────────
# 메인 처리 로직
# ──────────────────────────────────────────────

def main():
    os.makedirs(LANDMARKS_DIR, exist_ok=True)

    # MediaPipe Hands (이미지 모드: static_image_mode=True)
    mp_hands = mp.solutions.hands
    hands = mp_hands.Hands(
        static_image_mode=True,          # 이미지 단위 처리 (추적 비활성화)
        max_num_hands=2,
        min_detection_confidence=DETECTION_CONFIDENCE,
    )

    header = build_csv_header()

    # 전체 통계
    total_saved = 0
    total_skipped = 0

    for cls in CLASSES:
        class_dir = os.path.join(RAW_DIR, cls)

        # 해당 클래스 폴더가 없으면 건너뜀
        if not os.path.isdir(class_dir):
            print(f"[경고] 폴더 없음 — 건너뜀: {class_dir}")
            continue

        # CSV 파일 열기 (덮어쓰기 모드: 추출 때마다 새로 생성)
        csv_path = os.path.join(LANDMARKS_DIR, f'{cls}.csv')
        saved_count   = 0
        skipped_count = 0

        with open(csv_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(header)  # 헤더 행 기록

            # 폴더 내 모든 파일 순회
            for filename in sorted(os.listdir(class_dir)):
                filepath  = os.path.join(class_dir, filename)
                _, ext    = os.path.splitext(filename.lower())

                # ── 이미지 처리 ──
                if ext in IMAGE_EXTS:
                    frame = cv2.imread(filepath)
                    if frame is None:
                        print(f"  [오류] 이미지 로드 실패: {filename}")
                        skipped_count += 1
                        continue

                    vectors = process_frame(frame, hands)
                    if not vectors:
                        skipped_count += 1
                        continue

                    # 감지된 손 모두 저장 (첫 번째 손만 쓰려면 vectors[:1])
                    for vec in vectors:
                        writer.writerow(vec + [cls])
                        saved_count += 1

                # ── 영상(비디오) 처리 ──
                elif ext in VIDEO_EXTS:
                    cap = cv2.VideoCapture(filepath)
                    frame_idx = 0

                    # 비디오 모드에서는 추적을 활성화해 성능 향상
                    hands_video = mp_hands.Hands(
                        static_image_mode=False,
                        max_num_hands=2,
                        min_detection_confidence=DETECTION_CONFIDENCE,
                        min_tracking_confidence=0.5,
                    )

                    while cap.isOpened():
                        ret, frame = cap.read()
                        if not ret:
                            break

                        # 5프레임마다 1개 샘플링 (중복 프레임 방지)
                        if frame_idx % 5 == 0:
                            vectors = process_frame(frame, hands_video)
                            for vec in vectors:
                                writer.writerow(vec + [cls])
                                saved_count += 1
                        frame_idx += 1

                    cap.release()
                    hands_video.close()

        total_saved   += saved_count
        total_skipped += skipped_count
        print(f"[{cls:10s}] 저장: {saved_count:5d}개  건너뜀: {skipped_count:4d}개  →  {csv_path}")

    hands.close()

    print(f"\n=== 추출 완료 ===")
    print(f"총 저장: {total_saved}개  /  건너뜀: {total_skipped}개")
    print(f"CSV 저장 위치: {os.path.abspath(LANDMARKS_DIR)}")


if __name__ == '__main__':
    main()

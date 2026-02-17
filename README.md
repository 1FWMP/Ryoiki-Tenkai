# Ryoiki-Tenkai

주술회전(Jujutsu Kaisen) 캐릭터별 영역전개 손동작을 실시간으로 인식하는 웹 애플리케이션이다.
웹캠 영상에서 손 랜드마크를 추출하고, 학습된 MLP 모델로 제스처를 판별해 브라우저 위에 시각 효과를 출력한다.

## 인식 클래스

| 클래스 | 캐릭터 |
|--------|--------|
| gojo | 고조 사토루 (무량공처) |
| megumi | 후시구로 메구미 (개의 수리) |
| ryomen | 료멘 스쿠나 (악신의 성궤) |

## 기술 스택

| 영역 | 기술 |
|------|------|
| 모델 학습 | Python 3.11, MediaPipe, Keras MLP |
| 모델 변환 | tensorflowjs (.h5 → tfjs_model/) |
| 웹 프레임워크 | Vite + Vanilla JS (ES Modules) |
| 실시간 추적 | @mediapipe/tasks-vision (HandLandmarker) |
| 모델 추론 | @tensorflow/tfjs |
| 시각 효과 | Canvas API |

---

## 시스템 요구사항

- **Python**: 3.11 (Miniconda 또는 Anaconda)
- **Node.js**: 18 이상
- **웹캠**: 내장 또는 외장 USB 카메라
- **브라우저**: Chrome 또는 Edge (WebGL 필수)

---

## 설치

### Python 환경 구성

```bash
# 최초 1회 — Conda 가상환경 생성 및 패키지 설치
conda env create -f model/environment.yml

# 환경 활성화
conda activate ryoiki-tenkai
```

`environment.yml`에 포함된 주요 패키지:

| 패키지 | 버전 | 용도 |
|--------|------|------|
| mediapipe | >=0.10.0 | 손 랜드마크 추출 |
| tensorflow | >=2.13.0, <2.17.0 | Keras MLP 학습 |
| tensorflowjs | >=4.10.0 | .h5 → TF.js 변환 |
| opencv-python | >=4.8.0 | 웹캠 처리 |
| scikit-learn | >=1.3.0 | LabelEncoder, 데이터 분할 |

### 웹 환경 구성

```bash
cd web
npm install
```

---

## 모델 파이프라인

Python 스크립트 네 개를 순서대로 실행해 모델을 학습하고 웹에서 사용할 수 있는 형태로 변환한다.

```
collect_data.py  →  extract_landmarks.py  →  train.py  →  convert_to_tfjs.py
     (수집)              (추출)                (학습)           (변환)
```

### 1단계 — 데이터 수집 (`collect_data.py`)

웹캠 앞에서 직접 손동작을 보여주며 랜드마크 데이터를 수집한다.

```bash
conda activate ryoiki-tenkai
python model/scripts/collect_data.py
```

- 실행하면 클래스 선택 메시지가 표시된다 (gojo / ryomen / megumi).
- 카운트다운이 끝나면 웹캠 화면에서 손동작을 취한 채로 기다린다.
- 지정한 프레임 수만큼 수집이 완료되면 CSV에 자동 저장된다.
- 출력 위치: `model/data/landmarks/<class>.csv`

**랜드마크 정규화 방식**: 손목(landmark[0])을 원점으로 삼아 21개 관절 각각의 상대 좌표(x, y, z)를 계산한다. 결과는 63차원 벡터다.

### 2단계 — 영상/이미지에서 랜드마크 추출 (`extract_landmarks.py`)

이미 촬영된 이미지나 영상 파일에서 랜드마크를 일괄 추출한다. 1단계와 병행하거나 대체해서 사용할 수 있다.

```bash
conda activate ryoiki-tenkai
python model/scripts/extract_landmarks.py
```

입력 파일은 아래 구조에 맞게 배치한다.

```
model/data/raw/
├── gojo/        <- gojo 관련 이미지(.jpg, .png, .bmp) 또는 영상(.mp4, .avi, .mov, .mkv)
├── megumi/
└── ryomen/
```

- 영상 파일은 5프레임 간격으로 샘플링해 중복을 줄인다.
- 추출된 데이터는 `model/data/landmarks/<class>.csv`에 추가된다.

### 3단계 — 모델 학습 (`train.py`)

수집된 CSV 데이터로 Keras MLP를 학습한다.

```bash
conda activate ryoiki-tenkai
python model/scripts/train.py
```

**네트워크 구조**:

```
Input(63)
  -> Dense(128, relu) + Dropout(0.3)
  -> Dense(64, relu)  + Dropout(0.3)
  -> Dense(3, softmax)
```

**학습 설정**:

| 항목 | 값 |
|------|-----|
| 에포크 | 100 (EarlyStopping 적용) |
| 배치 크기 | 32 |
| 학습률 | 0.001 |
| 조기 종료 patience | 15 |
| 검증 비율 | 20% |

**출력 파일**:

| 파일 | 설명 |
|------|------|
| `model/models/gesture_model.h5` | 학습된 Keras 모델 |
| `model/models/training_history.png` | 정확도/손실 학습 곡선 |

**클래스 인덱스 매핑**: LabelEncoder는 알파벳 순으로 정렬하므로 아래 순서가 고정된다.

| 인덱스 | 클래스 |
|--------|--------|
| 0 | gojo |
| 1 | megumi |
| 2 | ryomen |

이 순서는 `web/src/core/GestureModel.js`의 `CLASS_NAMES` 배열과 반드시 일치해야 한다.

### 4단계 — TF.js 변환 (`convert_to_tfjs.py`)

학습된 `.h5` 모델을 브라우저에서 사용할 수 있는 TF.js 포맷으로 변환하고, 웹 프로젝트의 `public` 폴더로 복사한다.

```bash
conda activate ryoiki-tenkai
python model/scripts/convert_to_tfjs.py
```

**출력 위치**:

| 위치 | 설명 |
|------|------|
| `model/models/tfjs_model/` | 변환된 모델 원본 |
| `web/public/tfjs_model/` | 웹에서 직접 로드하는 모델 |

변환 후 `web/public/tfjs_model/` 에 `model.json`과 `group1-shard1of1.bin`이 생성되면 웹 앱을 바로 실행할 수 있다.

---

## 웹 앱 실행

```bash
cd web
npm run dev
```

브라우저에서 `http://localhost:5173`에 접속하면 카메라 권한 요청 후 실시간 인식이 시작된다.

### 프로덕션 빌드

```bash
cd web
npm run build      # web/dist/ 에 빌드 결과물 생성
npm run preview    # 빌드 결과물 로컬 미리보기
```

---

## 프로젝트 구조

```
claude-project/
├── model/
│   ├── environment.yml               # Conda 환경 정의
│   ├── data/
│   │   ├── raw/                      # 입력 이미지/영상 (클래스별 폴더)
│   │   └── landmarks/                # 추출된 랜드마크 CSV
│   │       ├── gojo.csv
│   │       ├── megumi.csv
│   │       └── ryomen.csv
│   ├── models/
│   │   ├── gesture_model.h5          # 학습된 Keras 모델
│   │   ├── training_history.png      # 학습 곡선
│   │   └── tfjs_model/               # 변환된 TF.js 모델
│   └── scripts/
│       ├── collect_data.py           # 웹캠 데이터 수집
│       ├── extract_landmarks.py      # 이미지/영상 랜드마크 추출
│       ├── train.py                  # MLP 학습
│       └── convert_to_tfjs.py        # .h5 → TF.js 변환
│
└── web/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── public/
    │   └── tfjs_model/               # 브라우저에서 로드하는 모델
    └── src/
        ├── main.js                   # 앱 진입점 (렌더 루프)
        ├── core/
        │   ├── HandTracker.js        # MediaPipe HandLandmarker 래퍼
        │   ├── GestureModel.js       # TF.js 추론 래퍼
        │   └── GestureRecognizer.js  # 연속 프레임 확정 로직
        ├── utils/
        │   └── EventEmitter.js       # 경량 이벤트 에미터
        └── effects/                  # 캐릭터별 시각 효과 (구현 예정)
```

---

## 핵심 파라미터

| 항목 | 값 | 위치 |
|------|----|------|
| 연속 확정 프레임 수 | 15 (~0.5초 @30fps) | `main.js` |
| 최소 신뢰도 임계값 | 0.85 (85%) | `main.js` |
| 확정 후 쿨다운 | 60프레임 (~2초 @30fps) | `main.js` |
| 손 감지 최소 신뢰도 | 0.7 | `HandTracker.js` |
| 최대 감지 손 개수 | 2 | `HandTracker.js` |

---

## 데이터 흐름

### Python 학습 파이프라인

```
웹캠 / 이미지 / 영상
        |
  MediaPipe HandLandmarker
        |
  21개 관절 좌표 (x, y, z)
        |
  손목 기준 정규화 → 63차원 벡터
        |
  CSV 저장 (landmarks/*.csv)
        |
  Keras MLP 학습 → gesture_model.h5
        |
  TF.js 변환 → web/public/tfjs_model/
```

### 웹 런타임 파이프라인

```
웹캠 프레임 (30fps)
        |
  HandTracker.detect()
        |
  21개 랜드마크 추출
        |
  HandTracker.normalizeLandmarks() → 63차원 Float32Array
        |
  GestureModel.inferSync() → 클래스별 확률
        |
  GestureRecognizer.update()
        |
  연속 15프레임 + 신뢰도 85% 충족
        |
  confirmed 이벤트 발생 → Canvas 시각 효과
```

### Canvas 레이어 구조

```
Layer 0: <video>          -- 웹캠 영상 (거울 모드)
Layer 1: canvas-skeleton  -- 손 랜드마크 스켈레톤 (디버그)
Layer 2: canvas-effect    -- 영역전개 시각 효과
Layer 3: #hud             -- 제스처명 + 신뢰도 오버레이
```

---

## 환경 업데이트

`environment.yml`을 변경한 경우:

```bash
conda env update -f model/environment.yml --prune
```

# Ryoiki-Tenkai

주술회전(Jujutsu Kaisen) 캐릭터별 영역전개 손동작을 실시간으로 인식하는 웹 애플리케이션이다.
웹캠 영상에서 **양손** 랜드마크를 추출하고, 학습된 MLP 모델로 제스처를 판별해 브라우저 위에 시각 효과를 출력한다.

## 인식 클래스

| 클래스 | 캐릭터 | 필요 손 개수 |
|--------|--------|-------------|
| gojo | 고조 사토루 (무량공처) | 한 손 |
| megumi | 후시구로 메구미 (개의 수리) | 양손 |
| ryomen | 료멘 스쿠나 (악신의 성궤) | 양손 |
| unknown | (제스처 없음 — 오인식 방지용) | 제한 없음 |

`unknown` 클래스는 실제 영역전개 포즈에 해당하지 않는 일반 손 자세를 학습시켜 오인식률을 낮추기 위한 더미 클래스다.

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

키 조작:

| 키 | 동작 |
|----|------|
| `1` | gojo 클래스 선택 |
| `2` | ryomen 클래스 선택 |
| `3` | megumi 클래스 선택 |
| `4` | unknown 클래스 선택 |
| `스페이스바` | 수집 시작 / 중지 (2초 카운트다운 후 시작) |
| `q` | 종료 |

**클래스별 손 개수 규칙**:

| 클래스 | 필요 손 수 | 주의사항 |
|--------|-----------|----------|
| gojo | 1 | 한 손만 화면에 보여야 저장된다 |
| ryomen | 2 | 양손이 모두 감지되어야 저장된다 |
| megumi | 2 | 양손이 모두 감지되어야 저장된다 |
| unknown | 제한 없음 | 다양한 손 자세를 섞어 수집한다 |

**랜드마크 정규화 방식**: 손목(landmark[0])을 원점으로 삼아 21개 관절 각각의 상대 좌표(x, y, z)를 계산한다. 한 손당 63차원.

**양손 벡터 구조**: `[왼손 63차원 | 오른손 63차원]` = 126차원. 감지되지 않은 손은 0으로 패딩한다.

**CSV 컬럼 구조**:
```
lx0, ly0, lz0, ..., lx20, ly20, lz20  (왼손 63개)
rx0, ry0, rz0, ..., rx20, ry20, rz20  (오른손 63개)
label
```
총 127열 (특징 126 + 레이블 1).

**handedness 주의사항**: MediaPipe는 손의 해부학적 형태(엄지 방향)로 handedness를 판별한다. 거울 모드(scaleX(-1)) 화면에서 물리적 오른손이 화면 왼쪽에 보이더라도 MediaPipe는 `"Right"`로 일관되게 반환한다. Python과 브라우저 양쪽 모두 원본(반전 전) 프레임을 MediaPipe에 전달하므로 Left/Right 슬롯이 자동으로 일치한다.

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
Input(126)
  -> Dense(128, relu) + Dropout(0.3)
  -> Dense(64, relu)  + Dropout(0.3)
  -> Dense(4, softmax)
```

입력 차원이 126인 이유: 양손 각 21개 랜드마크 × (x, y, z) × 2손.

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
| 3 | unknown |

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
│   │   └── landmarks/                # 추출된 랜드마크 CSV (126차원)
│   │       ├── gojo.csv
│   │       ├── megumi.csv
│   │       ├── ryomen.csv
│   │       └── unknown.csv
│   ├── models/
│   │   ├── gesture_model.h5          # 학습된 Keras 모델
│   │   ├── training_history.png      # 학습 곡선
│   │   └── tfjs_model/               # 변환된 TF.js 모델
│   └── scripts/
│       ├── collect_data.py           # 웹캠 데이터 수집 (양손 126차원)
│       ├── extract_landmarks.py      # 이미지/영상 랜드마크 추출
│       ├── train.py                  # MLP 학습 (Input 126, 출력 4클래스)
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
        │   ├── HandTracker.js        # MediaPipe HandLandmarker 래퍼 (양손 126차원)
        │   ├── GestureModel.js       # TF.js 추론 래퍼 (4클래스)
        │   └── GestureRecognizer.js  # 연속 프레임 확정 + 손 개수 검증
        ├── utils/
        │   └── EventEmitter.js       # 경량 이벤트 에미터
        └── effects/                  # 캐릭터별 시각 효과
```

---

## 핵심 파라미터

| 항목 | 값 | 위치 |
|------|----|------|
| 연속 확정 프레임 수 | 15 (~0.5초 @30fps) | `GestureRecognizer.js` |
| 최소 신뢰도 임계값 | 0.85 (85%) | `GestureRecognizer.js` |
| 확정 후 쿨다운 | 60프레임 (~2초 @30fps) | `GestureRecognizer.js` |
| 손 감지 최소 신뢰도 | 0.7 | `HandTracker.js` |
| 최대 감지 손 개수 | 2 | `HandTracker.js` |

---

## 데이터 흐름

### Python 학습 파이프라인

```
웹캠 / 이미지 / 영상
        |
  MediaPipe HandLandmarker (VIDEO 모드, 양손 감지)
        |
  handedness 기준으로 왼손/오른손 분류
        |
  각 손: 손목 기준 정규화 → 63차원 벡터
  감지 안 된 손: 63개의 0으로 패딩
        |
  [왼손 63 | 오른손 63] = 126차원 벡터
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
  HandTracker.detectBothHands()
        |
  { Left: 21개 랜드마크 | null, Right: 21개 랜드마크 | null }
        |
  HandTracker.normalizeBothHands() → 126차원 Float32Array
  (감지된 손 개수도 함께 집계)
        |
  GestureModel.inferSync() → 클래스별 확률 (4클래스)
        |
  GestureRecognizer.update(inferResult, handCount)
    - unknown → 스트릭 초기화
    - 클래스별 필요 손 개수 불일치 → 스트릭 초기화
    - 연속 15프레임 + 신뢰도 85% 충족
        |
  confirmed 이벤트 발생 → Canvas 시각 효과
```

### 손 개수 검증 (GestureRecognizer)

GestureRecognizer는 추론 결과와 함께 현재 프레임의 감지된 손 개수를 검사한다.
클래스별 필요 손 개수(`REQUIRED_HANDS`)와 일치하지 않으면 연속 카운트를 초기화해 오인식을 방지한다.

| 클래스 | 필요 손 수 | 불일치 시 동작 |
|--------|-----------|---------------|
| gojo | 1 | 양손 감지 시 스트릭 초기화 |
| ryomen | 2 | 한 손만 감지 시 스트릭 초기화 |
| megumi | 2 | 한 손만 감지 시 스트릭 초기화 |
| unknown | 0 (제한 없음) | 항상 스트릭 초기화 (unknown은 확정 불가) |

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

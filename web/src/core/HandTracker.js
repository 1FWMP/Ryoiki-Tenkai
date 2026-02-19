/**
 * HandTracker.js
 * ──────────────
 * MediaPipe Tasks Vision의 HandLandmarker를 래핑한 클래스.
 * 웹캠 비디오 스트림에서 실시간으로 손 랜드마크 21개를 추출한다.
 *
 * [변경] v2 — 양손 126차원 대응
 *   - detectBothHands(): handedness 기준으로 Left/Right 분류해 반환
 *   - normalizeBothHands(): [Left 63 | Right 63] 126차원 Float32Array 생성
 *
 * 사용 예시:
 *   const tracker = new HandTracker();
 *   await tracker.init();
 *
 *   // 매 프레임마다 호출 — { Left: landmarks|null, Right: landmarks|null }
 *   const handsMap = tracker.detectBothHands(videoElement);
 *   const vector   = HandTracker.normalizeBothHands(handsMap); // 126차원
 */

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

// MediaPipe WASM 파일이 위치한 CDN URL
const MEDIAPIPE_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm";

// HandLandmarker 모델 파일 URL
const HAND_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class HandTracker {
  /**
   * @param {object} options
   * @param {number} options.maxHands       - 동시에 감지할 최대 손 개수 (기본값: 2)
   * @param {number} options.minDetection   - 최초 감지 신뢰도 임계값 (기본값: 0.7)
   * @param {number} options.minPresence    - 손 존재 신뢰도 임계값 (기본값: 0.5)
   * @param {number} options.minTracking    - 추적 신뢰도 임계값 (기본값: 0.5)
   */
  constructor({ maxHands = 2, minDetection = 0.7, minPresence = 0.5, minTracking = 0.5 } = {}) {
    this._options = { maxHands, minDetection, minPresence, minTracking };

    /** @type {HandLandmarker|null} */
    this._landmarker = null;

    // 마지막으로 처리한 비디오 타임스탬프 (중복 프레임 처리 방지)
    this._lastTimestamp = -1;
  }

  /**
   * HandLandmarker 초기화. 앱 시작 시 한 번만 호출한다.
   * WASM 파일과 모델 파일을 네트워크에서 다운로드하므로 약간의 시간이 걸린다.
   *
   * @returns {Promise<void>}
   */
  async init() {
    // WASM 파일셋 로드 (MediaPipe 런타임 초기화)
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);

    // HandLandmarker 생성
    this._landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: HAND_LANDMARKER_MODEL_URL,
        // GPU 가속 우선 사용, 실패 시 CPU로 폴백
        delegate: "GPU",
      },
      runningMode: "VIDEO", // 비디오 스트림 모드
      numHands: this._options.maxHands,
      minHandDetectionConfidence: this._options.minDetection,
      minHandPresenceConfidence: this._options.minPresence,
      minTrackingConfidence: this._options.minTracking,
    });

    console.log("[HandTracker] 초기화 완료");
  }

  // ──────────────────────────────────────────────
  // Private: 원시 감지 결과 반환 (타임스탬프 중복 방지)
  // ──────────────────────────────────────────────

  /**
   * detectForVideo를 호출해 원시 HandLandmarkerResult를 반환하는 내부 메서드.
   * 동일 타임스탬프의 중복 처리를 막는다.
   *
   * @param {HTMLVideoElement} videoEl
   * @returns {import('@mediapipe/tasks-vision').HandLandmarkerResult|null}
   * @private
   */
  _detectRaw(videoEl) {
    if (!this._landmarker) {
      console.warn("[HandTracker] init()을 먼저 호출하세요.");
      return null;
    }

    const now = performance.now();
    if (now <= this._lastTimestamp) return null;
    this._lastTimestamp = now;

    return this._landmarker.detectForVideo(videoEl, now);
  }

  // ──────────────────────────────────────────────
  // Public: 양손 감지 (v2 주요 API)
  // ──────────────────────────────────────────────

  /**
   * 비디오 프레임에서 양손을 감지해 handedness 기준으로 분류한다.
   *
   * - MediaPipe handedness는 손 모양(엄지 방향 등)으로 판별하므로
   *   거울 모드 영상에서도 "Left" = 실제 왼손으로 일관되게 반환된다.
   * - Python collect_data.py와 동일한 handedness 분류 방식을 사용한다.
   *
   * @param {HTMLVideoElement} videoEl
   * @returns {{ Left: Array<{x,y,z}>|null, Right: Array<{x,y,z}>|null }}
   *   Left/Right 각각 21개 랜드마크 배열. 감지되지 않으면 null.
   */
  detectBothHands(videoEl) {
    const result = this._detectRaw(videoEl);
    const handsMap = { Left: null, Right: null };

    if (!result) return handsMap;

    const landmarks = result.landmarks ?? [];
    const handedness = result.handedness ?? [];

    for (let i = 0; i < landmarks.length; i++) {
      // categoryName: "Left" 또는 "Right"
      const side = handedness[i]?.[0]?.categoryName;
      if (side === "Left" || side === "Right") {
        handsMap[side] = landmarks[i];
      }
    }

    return handsMap;
  }

  /**
   * 비디오 엘리먼트의 현재 프레임에서 손 랜드마크를 감지한다.
   * (하위 호환용 — 단일 손 배열 반환)
   *
   * @param {HTMLVideoElement} videoEl
   * @returns {Array<Array<{x, y, z}>>} 감지된 손 배열. 손이 없으면 빈 배열.
   */
  detect(videoEl) {
    const result = this._detectRaw(videoEl);
    return result ? (result.landmarks ?? []) : [];
  }

  // ──────────────────────────────────────────────
  // Static: 랜드마크 정규화
  // ──────────────────────────────────────────────

  /**
   * 양손 랜드마크 맵을 126차원 Float32Array로 변환한다.
   *
   * MediaPipe Tasks API는 이미지 반전 여부와 무관하게
   * 손의 해부학적 형태(엄지 방향 등)로 handedness를 판별한다.
   * 따라서 Python(cv2.flip 적용)과 브라우저(raw 비디오) 양쪽 모두
   * 물리적 왼손 → "Left", 물리적 오른손 → "Right"를 일관되게 반환한다.
   *
   *   Python / Browser 공통:
   *     물리적 왼손  → "Left"  → 슬롯 0~62  (CSV lx/ly/lz 컬럼)
   *     물리적 오른손 → "Right" → 슬롯 63~125 (CSV rx/ry/rz 컬럼)
   *
   * 감지되지 않은 손은 63개의 0으로 패딩한다.
   *
   * [주의] gojo처럼 한 손 제스처의 경우, 수집 시 사용한 손(물리적 좌/우)과
   * 브라우저에서 사용하는 손이 반드시 일치해야 인식된다.
   * 거울 화면(scaleX(-1)) 때문에 물리적 오른손이 화면 왼쪽에 보이므로
   * 데이터 수집 시 혼동하지 않도록 주의한다.
   *
   * @param {{ Left: Array<{x,y,z}>|null, Right: Array<{x,y,z}>|null }} handsMap
   * @returns {Float32Array} 길이 126의 정규화된 특징 벡터
   */
  static normalizeBothHands(handsMap) {
    // 감지되지 않은 손은 0으로 패딩 (zeros = "없음"을 나타냄)
    const EMPTY = new Float32Array(63);

    const leftVec = handsMap.Left ? HandTracker.normalizeLandmarks(handsMap.Left) : EMPTY;
    const rightVec = handsMap.Right ? HandTracker.normalizeLandmarks(handsMap.Right) : EMPTY;

    // [왼손 63 | 오른손 63] 결합
    const combined = new Float32Array(126);
    combined.set(leftVec, 0);   // 인덱스 0~62
    combined.set(rightVec, 63); // 인덱스 63~125

    return combined;
  }

  /**
   * 랜드마크 21개를 Python 학습 시와 동일한 방식으로 정규화한다.
   * 손목(landmark[0])을 원점으로 삼아 상대 좌표 63차원 벡터를 반환.
   *
   * @param {Array<{x: number, y: number, z: number}>} landmarks - 단일 손의 21개 랜드마크
   * @returns {Float32Array} 길이 63의 정규화된 특징 벡터
   */
  static normalizeLandmarks(landmarks) {
    // 손목 기준점 (landmark[0])
    const wrist = landmarks[0];

    const vector = new Float32Array(63);
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      vector[i * 3 + 0] = lm.x - wrist.x; // 상대 x 좌표
      vector[i * 3 + 1] = lm.y - wrist.y; // 상대 y 좌표
      vector[i * 3 + 2] = lm.z - wrist.z; // 상대 z 좌표 (깊이)
    }
    return vector;
  }

  /**
   * HandTracker 자원 해제. 앱 종료 시 호출한다.
   */
  close() {
    if (this._landmarker) {
      this._landmarker.close();
      this._landmarker = null;
    }
  }
}

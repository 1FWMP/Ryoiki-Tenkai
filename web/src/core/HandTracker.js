/**
 * HandTracker.js
 * ──────────────
 * MediaPipe Tasks Vision의 HandLandmarker를 래핑한 클래스.
 * 웹캠 비디오 스트림에서 실시간으로 손 랜드마크 21개를 추출한다.
 *
 * 사용 예시:
 *   const tracker = new HandTracker();
 *   await tracker.init();
 *   // 매 프레임마다 호출
 *   const landmarks = tracker.detect(videoElement);
 *   // landmarks: Array<Array<{x, y, z}>> (감지된 손 개수 × 21개 랜드마크)
 */

import {
  FilesetResolver,
  HandLandmarker,
} from '@mediapipe/tasks-vision';

// MediaPipe WASM 파일이 위치한 CDN URL
// npm 패키지 내 wasm 파일을 직접 참조할 수도 있지만,
// CDN 사용이 초기 설정이 더 간단하다.
const MEDIAPIPE_WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';

// HandLandmarker 모델 파일 URL
const HAND_LANDMARKER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandTracker {
  /**
   * @param {object} options
   * @param {number} options.maxHands       - 동시에 감지할 최대 손 개수 (기본값: 2)
   * @param {number} options.minDetection   - 최초 감지 신뢰도 임계값 (기본값: 0.7)
   * @param {number} options.minPresence    - 손 존재 신뢰도 임계값 (기본값: 0.5)
   * @param {number} options.minTracking    - 추적 신뢰도 임계값 (기본값: 0.5)
   */
  constructor({
    maxHands     = 2,
    minDetection = 0.7,
    minPresence  = 0.5,
    minTracking  = 0.5,
  } = {}) {
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
        delegate: 'GPU',
      },
      runningMode:          'VIDEO',          // 비디오 스트림 모드
      numHands:             this._options.maxHands,
      minHandDetectionConfidence: this._options.minDetection,
      minHandPresenceConfidence:  this._options.minPresence,
      minTrackingConfidence:      this._options.minTracking,
    });

    console.log('[HandTracker] 초기화 완료');
  }

  /**
   * 비디오 엘리먼트의 현재 프레임에서 손 랜드마크를 감지한다.
   * requestAnimationFrame 루프 안에서 매 프레임 호출한다.
   *
   * @param {HTMLVideoElement} videoEl - 웹캠 스트림이 연결된 video 엘리먼트
   * @returns {Array<Array<{x: number, y: number, z: number}>>}
   *   감지된 손 배열. 각 손은 21개 랜드마크 객체 배열.
   *   손이 없으면 빈 배열([])을 반환.
   */
  detect(videoEl) {
    if (!this._landmarker) {
      console.warn('[HandTracker] init()을 먼저 호출하세요.');
      return [];
    }

    // 현재 비디오 타임스탬프 (밀리초)
    const now = performance.now();

    // 동일 타임스탬프 중복 처리 방지
    if (now <= this._lastTimestamp) {
      return [];
    }
    this._lastTimestamp = now;

    // 랜드마크 감지 실행
    const result = this._landmarker.detectForVideo(videoEl, now);

    // HandLandmarkerResult.landmarks: Array<NormalizedLandmark[]>
    // NormalizedLandmark: { x, y, z } (0.0 ~ 1.0으로 정규화된 좌표)
    return result.landmarks ?? [];
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
      vector[i * 3 + 0] = lm.x - wrist.x;  // 상대 x 좌표
      vector[i * 3 + 1] = lm.y - wrist.y;  // 상대 y 좌표
      vector[i * 3 + 2] = lm.z - wrist.z;  // 상대 z 좌표 (깊이)
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

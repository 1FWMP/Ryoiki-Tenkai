/**
 * PersonSegmenter.js
 * ──────────────────
 * MediaPipe Tasks Vision의 ImageSegmenter(selfie_segmenter 모델)를 래핑해
 * 웹캠 영상에서 사람 영역만 잘라내어(누끼) canvas에 그리는 클래스.
 *
 * 레이어 역할:
 *   canvas-person (z-index: 3) 위에 배경 없이 사람만 렌더링한다.
 *   영역전개 효과(canvas-effect, z-index: 1)가 사람 뒤에 표시된다.
 *
 * 픽셀 합성 흐름 (매 프레임):
 *   1. segmentForVideo() → categoryMask (uint8: 0=배경, 1=사람)
 *   2. 오프스크린 캔버스에 비디오를 거울 반전(scaleX(-1))으로 그림
 *   3. categoryMask의 x 좌표를 반전해 거울 좌표계와 맞춤
 *   4. 사람 영역(mask === 1)에만 alpha=255, 배경은 alpha=0 적용
 *   5. 결과를 canvas-person에 출력
 *
 * [폴백] 세그멘터 초기화 실패 또는 런타임 오류 시 거울 반전 비디오를 그대로 표시한다.
 */

import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

// HandTracker.js와 동일한 CDN 경로 사용
const MEDIAPIPE_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm";

// Selfie Segmenter 경량 모델 (float16, ~500KB)
const SELFIE_SEGMENTER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

export class PersonSegmenter {
  /**
   * @param {number} width  - 초기 캔버스 너비 (resizeCanvases 후 갱신됨)
   * @param {number} height - 초기 캔버스 높이
   */
  constructor(width = 0, height = 0) {
    /** @type {ImageSegmenter|null} */
    this._segmenter = null;

    // 오프스크린 캔버스: 비디오 거울 반전 + alpha 마스킹에 사용
    this._offCanvas = new OffscreenCanvas(width || 1, height || 1);
    this._offCtx    = this._offCanvas.getContext("2d", { willReadFrequently: true });

    this._w = width;
    this._h = height;

    // 첫 프레임 진단 로그 플래그
    this._diagDone = false;

    // 세그멘터가 에러를 낸 적이 있으면 true → 이후 폴백 모드로 실행
    this._fallback = false;
  }

  /**
   * ImageSegmenter 초기화. 앱 시작 시 한 번만 호출한다.
   * WASM 파일과 모델 파일을 CDN에서 다운로드하므로 시간이 걸릴 수 있다.
   * 실패 시 폴백 모드(거울 비디오 표시)로 전환한다.
   *
   * @returns {Promise<void>}
   */
  async init() {
    try {
      // WASM 런타임 초기화 (HandTracker와 동일 FilesetResolver 공유 불가 → 재호출)
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);

      this._segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: SELFIE_SEGMENTER_MODEL_URL,
          // GPU 가속 우선, 실패 시 CPU 폴백
          delegate: "GPU",
        },
        runningMode:           "VIDEO",  // 실시간 비디오 스트림 모드
        outputCategoryMask:    true,     // uint8 카테고리 마스크 출력
        outputConfidenceMasks: false,    // float 신뢰도 마스크 불필요
      });

      console.log("[PersonSegmenter] 초기화 완료 — selfie segmentation 활성화");
    } catch (err) {
      // 초기화 실패 → 폴백 모드 (거울 비디오만 표시)
      console.warn("[PersonSegmenter] 초기화 실패, 폴백 모드(거울 비디오)로 전환:", err);
      this._fallback = true;
    }
  }

  /**
   * 캔버스 크기가 변경될 때 호출해 오프스크린 캔버스 크기를 동기화한다.
   *
   * @param {number} w - 새 너비
   * @param {number} h - 새 높이
   */
  resize(w, h) {
    this._w = w;
    this._h = h;
    // OffscreenCanvas는 width/height 속성으로 크기 변경
    this._offCanvas.width  = w;
    this._offCanvas.height = h;
  }

  // ──────────────────────────────────────────────
  // Private: 거울 반전 비디오 그리기 (폴백)
  // ──────────────────────────────────────────────

  /**
   * CSS object-fit:cover 와 동일한 소스 크롭 파라미터를 계산한다.
   * 캔버스(this._w × this._h)를 채우기 위해 비디오 프레임에서
   * 잘라낼 영역(sx, sy, sw, sh)과 원본 비디오 해상도(vw, vh)를 반환한다.
   *
   * @param {HTMLVideoElement} videoEl
   * @returns {{ sx:number, sy:number, sw:number, sh:number, vw:number, vh:number }}
   */
  _computeCoverCrop(videoEl) {
    const vw = videoEl.videoWidth  || this._w;
    const vh = videoEl.videoHeight || this._h;
    const canvasAspect = this._w / this._h;
    const videoAspect  = vw / vh;

    let sx = 0, sy = 0, sw = vw, sh = vh;

    if (canvasAspect > videoAspect) {
      // 캔버스가 더 넓음 → 비디오 너비 기준으로 맞추고 세로 크롭
      sh = vw / canvasAspect;
      sy = (vh - sh) / 2;
    } else if (canvasAspect < videoAspect) {
      // 캔버스가 더 높음 → 비디오 높이 기준으로 맞추고 가로 크롭
      sw = vh * canvasAspect;
      sx = (vw - sw) / 2;
    }

    return { sx, sy, sw, sh, vw, vh };
  }

  /**
   * 세그멘테이션 없이 거울 반전 비디오를 ctx에 직접 그린다.
   * 세그멘터 초기화 실패 또는 런타임 오류 시 호출된다.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLVideoElement} videoEl
   */
  _drawMirroredVideo(ctx, videoEl) {
    const { sx, sy, sw, sh } = this._computeCoverCrop(videoEl);
    ctx.save();
    ctx.translate(this._w, 0);
    ctx.scale(-1, 1);
    // object-fit:cover 와 동일하게 크롭된 영역을 캔버스 전체에 그림
    ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, this._w, this._h);
    ctx.restore();
  }

  // ──────────────────────────────────────────────
  // Public: 매 프레임 사람 누끼 그리기
  // ──────────────────────────────────────────────

  /**
   * 매 프레임 호출해 사람 누끼를 canvas-person에 그린다.
   * 세그멘터 오류 시 폴백으로 거울 반전 비디오를 표시한다.
   *
   * @param {HTMLVideoElement} videoEl    - 웹캠 비디오 엘리먼트 (소스)
   * @param {CanvasRenderingContext2D} ctx - canvas-person의 2D 컨텍스트
   * @param {number} timestamp            - rAF 기준 타임스탬프 (ms, 단조 증가)
   */
  drawPerson(videoEl, ctx, timestamp) {
    // 비디오 미준비 시 건너뜀
    if (videoEl.readyState < 2) return;

    // 캔버스 초기화
    ctx.clearRect(0, 0, this._w, this._h);

    // ── 세그멘터 미초기화 또는 폴백 모드 ──
    if (!this._segmenter || this._fallback) {
      this._drawMirroredVideo(ctx, videoEl);
      return;
    }

    try {
      // ── 1. 세그멘테이션 수행 ──
      // segmentForVideo는 VIDEO 모드에서 동기적으로 결과를 반환한다.
      const result = this._segmenter.segmentForVideo(videoEl, timestamp);

      // categoryMask 가용 여부 확인
      if (!result.categoryMask) {
        console.warn("[PersonSegmenter] categoryMask가 없음 → 폴백 모드로 전환");
        this._fallback = true;
        result.close?.();
        this._drawMirroredVideo(ctx, videoEl);
        return;
      }

      // Uint8Array로 마스크 추출 (카테고리 인덱스: 0=배경, 1=사람)
      const categoryMask = result.categoryMask.getAsUint8Array();

      // ── object-fit:cover 크롭 파라미터 계산 ──
      // 캔버스 픽셀 크기는 뷰포트와 같고, 비디오는 이 영역을 cover로 채운다.
      // 동일한 크롭을 오프스크린 드로잉과 마스크 좌표 역산에 공통으로 사용한다.
      const { sx, sy, sw, sh, vw, vh } = this._computeCoverCrop(videoEl);

      // ── 진단: 첫 프레임에서 마스크 크기 로그 ──
      if (!this._diagDone) {
        this._diagDone = true;
        const maskLen = categoryMask.length;
        console.log(
          `[PersonSegmenter] 첫 프레임 진단 — ` +
          `마스크 길이: ${maskLen}, ` +
          `비디오: ${vw}×${vh} (예상: ${vw * vh}), ` +
          `일치: ${maskLen === vw * vh}`
        );
        // 마스크 값 샘플 (중앙 픽셀 근처 5개)
        const mid = Math.floor(maskLen / 2);
        console.log("[PersonSegmenter] 마스크 중앙 샘플:", [...categoryMask.slice(mid, mid + 5)]);
      }

      // ── 마스크 크기 결정 ──
      // 마스크는 비디오 원본 해상도 기준이므로 vw×vh 와 비교해 추정한다.
      // (캔버스 픽셀 크기는 뷰포트이므로 this._w×this._h 와 비교하면 항상 불일치)
      const maskTotal = categoryMask.length;
      let maskW = vw;
      let maskH = vh;

      if (maskTotal !== vw * vh) {
        // 마스크가 비디오보다 낮은 해상도 → 비디오 비율로 추정
        const videoRatio = vw / vh;
        maskH = Math.round(Math.sqrt(maskTotal / videoRatio));
        maskW = Math.round(maskH * videoRatio);
        if (!this._maskWarnDone) {
          this._maskWarnDone = true;
          console.warn(
            `[PersonSegmenter] 마스크 크기 불일치 — ` +
            `비디오: ${vw}×${vh}, ` +
            `추정 실제: ${maskW}×${maskH}`
          );
        }
      }

      // ── 2. 오프스크린 캔버스에 object-fit:cover 방식으로 거울 반전 비디오 그리기 ──
      // 비디오 소스의 (sx, sy, sw, sh) 크롭 영역만 캔버스 전체에 확대해 그린다.
      // 이렇게 하면 CSS object-fit:cover 와 동일한 화면 영역이 오프스크린에 표시된다.
      this._offCtx.save();
      this._offCtx.translate(this._w, 0);
      this._offCtx.scale(-1, 1);
      this._offCtx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, this._w, this._h);
      this._offCtx.restore();

      // ── 3. 픽셀별 alpha 마스킹 ──
      // getImageData로 오프스크린 픽셀 데이터를 가져와 alpha 채널 수정
      const imageData = this._offCtx.getImageData(0, 0, this._w, this._h);
      const data      = imageData.data; // Uint8ClampedArray: [R,G,B,A, R,G,B,A, ...]

      for (let y = 0; y < this._h; y++) {
        for (let x = 0; x < this._w; x++) {
          // 캔버스 픽셀 (x, y) → 원본 비디오 좌표 역산
          // 오프스크린은 scaleX(-1) 거울 반전이므로 x 를 반전(this._w - x)해서
          // cover 크롭 오프셋(sx, sy)과 스케일(sw/this._w, sh/this._h)을 더한다.
          const videoX = sx + ((this._w - x) / this._w) * sw;
          const videoY = sy + (y / this._h) * sh;

          // 원본 비디오 좌표 → 마스크 좌표 (경계값 클램프)
          const mx = Math.min(Math.floor((videoX / vw) * maskW), maskW - 1);
          const my = Math.min(Math.floor((videoY / vh) * maskH), maskH - 1);
          const maskIdx = my * maskW + mx;

          // getAsUint8Array() 반환값: 0 = 사람(foreground), 255 = 배경
          const alpha = categoryMask[maskIdx] === 0 ? 255 : 0;

          // 픽셀 인덱스: RGBA 배열에서 A 채널은 오프셋 +3
          data[(y * this._w + x) * 4 + 3] = alpha;
        }
      }

      // 수정된 alpha를 오프스크린 캔버스에 다시 기록
      this._offCtx.putImageData(imageData, 0, 0);

      // ── 4. canvas-person에 최종 출력 ──
      ctx.drawImage(this._offCanvas, 0, 0);

      // ── 5. MediaPipe 결과 객체 메모리 해제 ──
      result.close();

    } catch (err) {
      // 런타임 오류 → 폴백 모드로 전환 (이후 프레임부터 거울 비디오 사용)
      console.error("[PersonSegmenter] drawPerson 런타임 오류, 폴백 모드 전환:", err);
      this._fallback = true;
      this._drawMirroredVideo(ctx, videoEl);
    }
  }
}

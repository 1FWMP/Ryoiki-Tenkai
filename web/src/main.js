/**
 * main.js
 * ───────
 * 앱 진입점. 모든 모듈을 초기화하고 메인 렌더 루프를 실행한다.
 *
 * 실행 흐름:
 *  1. HandTracker 초기화 (MediaPipe WASM 로드)
 *  2. GestureModel 로드 (TF.js 모델 로드)
 *  3. 웹캠 스트림 획득 (getUserMedia)
 *  4. GestureRecognizer 이벤트 바인딩
 *  5. requestAnimationFrame 루프 시작
 *     → HandTracker.detectBothHands() → HandTracker.normalizeBothHands()
 *     → GestureModel.inferSync() → GestureRecognizer.update()
 */

import { HandTracker }        from './core/HandTracker.js';
import { GestureModel }       from './core/GestureModel.js';
import { GestureRecognizer }  from './core/GestureRecognizer.js';
import { EffectManager }      from './effects/EffectManager.js';

// ──────────────────────────────────────────────
// DOM 요소 참조
// ──────────────────────────────────────────────
const videoEl     = document.getElementById('video');
const canvasSkel  = document.getElementById('canvas-skeleton');
const canvasEffect = document.getElementById('canvas-effect');
const hudEl       = document.getElementById('hud');
const loadingEl   = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');

// Canvas 2D 컨텍스트
const ctxSkel   = canvasSkel.getContext('2d');
const ctxEffect = canvasEffect.getContext('2d');

// ──────────────────────────────────────────────
// 모듈 인스턴스
// ──────────────────────────────────────────────
const tracker    = new HandTracker();
const model      = new GestureModel();
const recognizer = new GestureRecognizer({
  requiredFrames: 15,    // 연속 15프레임 (≈0.5초 @30fps)
  minConfidence:  0.85,  // 85% 이상 신뢰도
  cooldownFrames: 60,    // 확정 후 60프레임 쿨다운
});

// EffectManager — canvas-effect 위에 영역전개 효과를 그린다.
// 캔버스 크기는 resizeCanvases() 호출 후 확정되므로 임시로 0,0 으로 초기화
const effectManager = new EffectManager(ctxEffect, 0, 0);

// ──────────────────────────────────────────────
// 초기화 함수
// ──────────────────────────────────────────────

/**
 * 웹캠 스트림을 획득해 video 엘리먼트에 연결한다.
 * 카메라 권한 거부 시 에러를 던진다.
 */
async function startCamera() {
  loadingText.textContent = '카메라 권한 요청 중...';

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width:     { ideal: 1280 },
      height:    { ideal: 720  },
      facingMode: 'user',        // 전면 카메라
    },
    audio: false,
  });

  videoEl.srcObject = stream;

  // 비디오 메타데이터 로드 완료까지 대기
  await new Promise(resolve => {
    videoEl.onloadedmetadata = () => {
      videoEl.play();
      resolve();
    };
  });
}

/**
 * Canvas 크기를 비디오 해상도에 맞춘다.
 * 창 크기 변경 시에도 다시 호출된다.
 */
function resizeCanvases() {
  const w = videoEl.videoWidth  || window.innerWidth;
  const h = videoEl.videoHeight || window.innerHeight;

  canvasSkel.width  = canvasEffect.width  = w;
  canvasSkel.height = canvasEffect.height = h;

  // 효과 인스턴스의 크기도 동기화
  effectManager.resize(w, h);
}

// ──────────────────────────────────────────────
// 이벤트 바인딩
// ──────────────────────────────────────────────

/**
 * 제스처 확정 이벤트: 해당 캐릭터의 영역전개 효과를 발동한다.
 */
recognizer.on('confirmed', ({ className, confidence }) => {
  console.log(`✅ 영역전개 확정: ${className} (${(confidence * 100).toFixed(1)}%)`);

  // 캐릭터에 맞는 영역전개 효과 발동
  effectManager.trigger(className);

  hudEl.textContent = `✅ ${className.toUpperCase()} — ${(confidence * 100).toFixed(0)}%`;
});

/**
 * 리셋 이벤트: 손이 사라져 대기 상태로 복귀 → 효과 종료
 */
recognizer.on('reset', () => {
  // 효과 중단 및 캔버스 클리어
  effectManager.reset();
  hudEl.textContent = '';
});

// ──────────────────────────────────────────────
// 메인 렌더 루프
// ──────────────────────────────────────────────

/**
 * requestAnimationFrame 기반 메인 루프.
 * 매 프레임:
 *  1. 손 랜드마크 감지
 *  2. 스켈레톤 시각화 (디버그)
 *  3. 제스처 추론 & 확정 판정
 *  4. HUD 진행 바 업데이트
 *  5. 영역전개 효과 렌더 (EffectManager)
 */
function renderLoop(timestamp) {
  // 비디오가 준비되지 않았으면 건너뜀
  if (videoEl.readyState < 2) {
    requestAnimationFrame(renderLoop);
    return;
  }

  // 스켈레톤 캔버스 초기화
  ctxSkel.clearRect(0, 0, canvasSkel.width, canvasSkel.height);

  // ── 양손 랜드마크 감지 (handedness 기준 Left/Right 분류) ──
  const handsMap = tracker.detectBothHands(videoEl);
  const hasAnyHand = handsMap.Left !== null || handsMap.Right !== null;

  if (hasAnyHand) {
    // 감지된 각 손의 랜드마크를 디버그 시각화
    if (handsMap.Left)  drawLandmarks(ctxSkel, handsMap.Left);
    if (handsMap.Right) drawLandmarks(ctxSkel, handsMap.Right);

    // 126차원 정규화 벡터 생성: [왼손 63 | 오른손 63]
    // 감지되지 않은 손은 0으로 패딩 (unknown 클래스가 처리)
    const vector = HandTracker.normalizeBothHands(handsMap);

    // 감지된 손 개수 (GestureRecognizer의 손 개수 검증에 사용)
    const handCount = (handsMap.Left !== null ? 1 : 0) + (handsMap.Right !== null ? 1 : 0);

    // ── 제스처 추론 (동기) ──
    if (model.isLoaded) {
      const inferResult = model.inferSync(vector);
      // handCount를 함께 전달해 클래스별 손 개수 조건 검증
      recognizer.update(inferResult, handCount);

      // HUD: 현재 진행 상황 업데이트
      updateProgressHUD(inferResult);
    }
  } else {
    // 손이 전혀 감지되지 않으면 인식기에 알려 스트릭 초기화 및 효과 종료 처리
    recognizer.handleNoHand();
  }

  // ── 영역전개 효과 렌더 (활성 효과가 있을 때만 실행) ──
  effectManager.draw(timestamp);

  requestAnimationFrame(renderLoop);
}

/**
 * 손 랜드마크 21개를 캔버스에 점으로 그린다 (디버그용).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x, y, z}>} landmarks
 */
function drawLandmarks(ctx, landmarks) {
  const w = canvasSkel.width;
  const h = canvasSkel.height;

  ctx.fillStyle = 'rgba(0, 255, 128, 0.8)';
  for (const lm of landmarks) {
    // MediaPipe 좌표는 0~1로 정규화됨 → 캔버스 픽셀로 변환
    // video는 scaleX(-1) 미러이므로 x축 반전
    const x = (1 - lm.x) * w;
    const y = lm.y * h;

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * HUD에 현재 제스처 추론 상태를 표시한다.
 * @param {{ className: string, confidence: number }} inferResult
 */
function updateProgressHUD(inferResult) {
  const { currentClass, progress } = recognizer.getProgress();

  // 확정되지 않은 상태에서만 진행 바 표시
  if (currentClass) {
    const pct = Math.min(progress * 100, 100).toFixed(0);
    hudEl.innerHTML =
      `<div style="font-size:1rem; margin-bottom:4px;">${currentClass} — ${(inferResult.confidence * 100).toFixed(0)}%</div>` +
      `<div style="width:200px; height:8px; background:#333; border-radius:4px;">` +
      `  <div style="width:${pct}%; height:100%; background:#7c3aed; border-radius:4px; transition:width 0.1s;"></div>` +
      `</div>`;
  }
}

// ──────────────────────────────────────────────
// 앱 진입점
// ──────────────────────────────────────────────

async function init() {
  try {
    // HandTracker (MediaPipe) 초기화
    loadingText.textContent = 'MediaPipe 모델 로드 중...';
    await tracker.init();

    // TF.js 모델 로드
    loadingText.textContent = 'TF.js 제스처 모델 로드 중...';
    await model.load();

    // 웹캠 스트림 시작
    await startCamera();

    // 캔버스 크기 설정
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);

    // 로딩 화면 숨김
    loadingEl.style.display = 'none';

    // 메인 루프 시작
    console.log('[main] 앱 시작 — 렌더 루프 실행 중');
    requestAnimationFrame(renderLoop);

  } catch (err) {
    loadingText.textContent = `오류: ${err.message}`;
    console.error('[main] 초기화 실패:', err);
  }
}

// DOM 로드 완료 후 초기화 실행
init();

// ──────────────────────────────────────────────
// 테스트용 키보드 단축키
//   1 → 고죠 (무량공처)
//   2 → 료멘 (맹독한 사당)
//   3 → 메구미 (嵌합암영정)
//   0 → 효과 초기화
// ──────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if      (e.key === '1') effectManager.trigger('gojo');
  else if (e.key === '2') effectManager.trigger('ryomen');
  else if (e.key === '3') effectManager.trigger('megumi');
  else if (e.key === '0') effectManager.reset();
});

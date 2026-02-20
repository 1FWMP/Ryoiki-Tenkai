/**
 * GojoEffect.js
 * ─────────────
 * 고죠 사토루의 영역전개 — 무량공처(無量空處) 시각 효과.
 *
 * 시각적 특징 (v2 — 방사형 광선 폭발):
 *  - 중심에서 화면 끝까지 뻗어나가는 수십 개의 날카로운 빛줄기
 *  - 분홍/보라/흰색의 강렬한 색조
 *  - 광선마다 독립적인 속도·너비·불투명도로 유기적인 느낌
 *  - 중심부 눈부신 백색 → 보라 글로우 폭발
 *  - 글로우 링이 외부로 팽창하며 충격파 표현
 *  - 미세한 파티클 흩날림 (광선 사이 공간감)
 *  - "無量空處" 텍스트 페이드 인
 */
export class GojoEffect {
  /**
   * @param {CanvasRenderingContext2D} ctx    - 효과를 그릴 canvas 2D 컨텍스트
   * @param {number}                   width  - 캔버스 너비 (px)
   * @param {number}                   height - 캔버스 높이 (px)
   */
  constructor(ctx, width, height) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;

    this.active = false;
    this.startTime = 0;

    // 광선 배열
    this.beams = [];
    // 미세 파티클 배열
    this.sparks = [];
    // 충격파 링 배열
    this.shockwaves = [];

    this._initBeams();
    this._initSparks();
  }

  // ── 초기화 ──────────────────────────────────────

  /**
   * 방사형 광선 100개를 초기화한다.
   * 각 광선은 각도, 너비, 색상, 속도, 길이가 다르다.
   */
  _initBeams() {
    const count = 100;
    this.beams = Array.from({ length: count }, (_, i) => {
      const baseAngle = (i / count) * Math.PI * 2;
      const jitter = (Math.random() - 0.5) * ((Math.PI * 2) / count) * 1.8;

      // 이미지 기반 색상 팔레트: 순백, 강렬한 붉은색, 짙은 푸른색, 마젠타/자홍, 밝은 보라
      const palette = [
        [255, 255, 255], // 순백 (가장 밝은 코어)
        [240, 30, 60], // 강렬한 붉은색 (Red)
        [40, 40, 220], // 짙은 푸른색 (Deep Blue)
        [220, 60, 200], // 마젠타/자홍 (Magenta)
        [170, 100, 240], // 밝은 라벤더/보라 (Light Violet)
      ];
      const col = palette[Math.floor(Math.random() * palette.length)];

      return {
        angle: baseAngle + jitter,
        width: Math.random() * 4 + 1,
        length: 0,
        maxLen: Math.max(this.width, this.height) * (1.1 + Math.random() * 0.4),
        speed: 200 + Math.random() * 40,
        opacity: 0.55 + Math.random() * 0.45,
        color: col,
        delay: Math.floor(Math.random() * 12),
        frame: 0,
        glowW: Math.random() * 14 + 6,
      };
    });
  }

  /**
   * 미세 불꽃 파티클 120개를 초기화한다.
   */
  _initSparks() {
    this.sparks = Array.from({ length: 120 }, () => ({
      x: 0,
      y: 0,
      angle: Math.random() * Math.PI * 2,
      speed: Math.random() * 4.5 + 1.5,
      size: Math.random() * 2 + 0.5,
      life: 1.0,
      decay: Math.random() * 0.012 + 0.004,
      delay: Math.floor(Math.random() * 25),
      frame: 0,
      color: `hsl(${280 + Math.random() * 60}, 100%, ${70 + Math.random() * 30}%)`,
    }));
  }

  // ── 공개 메서드 ──────────────────────────────────

  /** 효과를 시작한다. */
  start() {
    this.active = true;
    this.startTime = performance.now();

    // 광선 · 파티클 리셋
    this._initBeams();
    this._initSparks();

    // 충격파 링 초기화 (3개, 순차 발사)
    this.shockwaves = Array.from({ length: 3 }, (_, i) => ({
      radius: 0,
      maxR: Math.max(this.width, this.height) * 0.9,
      speed: 6 + i * 2,
      opacity: 0.9 - i * 0.25,
      delay: i * 20,
      frame: 0,
    }));
  }

  /** 효과를 정지한다. */
  stop() {
    this.active = false;
  }

  /**
   * 매 프레임 호출 — 무량공처 효과를 캔버스에 그린다.
   * @param {DOMHighResTimeStamp} timestamp
   */
  draw(timestamp) {
    if (!this.active) return;

    const { ctx, width: w, height: h } = this;
    const elapsed = Math.max(0, timestamp - this.startTime);
    const cx = w / 2;
    const cy = h / 2;

    // ─ 1. 배경 오버레이 (기존과 동일) ─
    ctx.fillStyle = "rgba(5, 0, 12, 1)";
    ctx.fillRect(0, 0, w, h);

    // ─ 2. 광선 렌더 (회전·일렁임 없이 빠르고 날카로운 직선 방사) ─
    for (const beam of this.beams) {
      beam.frame++;
      if (beam.frame < beam.delay) continue;

      // 매 프레임 speed만큼 길이를 늘려 광선이 중심에서 외곽으로 뻗어나가게 한다
      beam.length += beam.speed;

      // 화면 끝에 도달하면 길이를 리셋하고 황금각(≈137.5°)을 더해 각도를 변경한다.
      // 황금각 분할로 연속 루프마다 광선이 겹치지 않는 새로운 방향에서 재발사된다.
      if (beam.length >= beam.maxLen) {
        beam.length = 0;
        beam.angle += 2.39996;
      }

      const ex = cx + Math.cos(beam.angle) * beam.length;
      const ey = cy + Math.sin(beam.angle) * beam.length;

      const progress = beam.length / beam.maxLen;
      const alpha = beam.opacity * (1 - progress * 0.6);

      // 외곽 글로우 레이어
      const glowGrad = ctx.createLinearGradient(cx, cy, ex, ey);
      glowGrad.addColorStop(0, `rgba(${beam.color.join(",")}, ${alpha * 0.8})`);
      glowGrad.addColorStop(0.3, `rgba(${beam.color.join(",")}, ${alpha * 0.35})`);
      glowGrad.addColorStop(1, `rgba(${beam.color.join(",")}, 0)`);

      ctx.save();
      ctx.strokeStyle = glowGrad;
      ctx.lineWidth = beam.glowW;
      ctx.lineCap = "round";
      ctx.globalCompositeOperation = "screen";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // 코어 광선
      const coreGrad = ctx.createLinearGradient(cx, cy, ex, ey);
      coreGrad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      coreGrad.addColorStop(0.2, `rgba(${beam.color.join(",")}, ${alpha * 0.7})`);
      coreGrad.addColorStop(1, `rgba(${beam.color.join(",")}, 0)`);

      ctx.strokeStyle = coreGrad;
      ctx.lineWidth = beam.width;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.restore();
    }

    // ─ 3. 충격파 링 ─
    for (const sw of this.shockwaves) {
      sw.frame++;
      if (sw.frame < sw.delay) continue;

      sw.radius = Math.min(sw.radius + sw.speed, sw.maxR);
      const progress = sw.radius / sw.maxR;
      const alpha = sw.opacity * (1 - progress);

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.strokeStyle = `rgba(255, 160, 240, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = "rgba(255, 100, 220, 0.8)";
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(cx, cy, sw.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ─ 4. 미세 불꽃 파티클 ─
    for (const sp of this.sparks) {
      sp.frame++;
      if (sp.frame < sp.delay) continue;

      // 첫 활성화 시 위치를 중심으로 설정
      if (sp.frame === sp.delay) {
        sp.x = cx + (Math.random() - 0.5) * 20;
        sp.y = cy + (Math.random() - 0.5) * 20;
      }

      sp.x += Math.cos(sp.angle) * sp.speed;
      sp.y += Math.sin(sp.angle) * sp.speed;
      sp.life -= sp.decay;

      if (sp.life <= 0) {
        // 리셋
        sp.x = cx + (Math.random() - 0.5) * 30;
        sp.y = cy + (Math.random() - 0.5) * 30;
        sp.angle = Math.random() * Math.PI * 2;
        sp.speed = Math.random() * 4.5 + 1.5;
        sp.life = 1.0;
      }

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = sp.color;
      ctx.globalAlpha = Math.max(0, sp.life) * 0.85;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ─ 5. 중심 폭발 글로우 ─
    const glowPulse = 60 + Math.sin(elapsed / 120) * 18;

    // 가장 바깥 — 보라 후광
    const outerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowPulse * 3.5);
    outerGlow.addColorStop(0, "rgba(255, 180, 255, 0.20)");
    outerGlow.addColorStop(0.4, "rgba(200,  60, 230, 0.12)");
    outerGlow.addColorStop(1, "rgba(0,     0,  20, 0.00)");
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = outerGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, glowPulse * 3.5, 0, Math.PI * 2);
    ctx.fill();

    // 중간 — 분홍 코어
    const midGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowPulse * 1.4);
    midGlow.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    midGlow.addColorStop(0.2, "rgba(255, 160, 240, 0.80)");
    midGlow.addColorStop(0.6, "rgba(200,  60, 230, 0.40)");
    midGlow.addColorStop(1, "rgba(0,     0,  20, 0.00)");
    ctx.fillStyle = midGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, glowPulse * 1.4, 0, Math.PI * 2);
    ctx.fill();

    // 핵 — 순백 점
    const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowPulse * 0.4);
    coreGlow.addColorStop(0, "rgba(255, 255, 255, 1.00)");
    coreGlow.addColorStop(1, "rgba(255, 220, 255, 0.00)");
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, glowPulse * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 텍스트만 별도 캔버스(canvas-text, z-index:4)에 그린다.
   * EffectManager.draw() 에서 canvas-person 위 레이어에 호출된다.
   *
   * @param {CanvasRenderingContext2D} ctx - canvas-text 의 2D 컨텍스트
   * @param {DOMHighResTimeStamp} timestamp
   */
  drawText(ctx, timestamp) {
    if (!this.active) return;

    const elapsed = Math.max(0, timestamp - this.startTime);
    if (elapsed <= 1200) return; // 1.2초 후 페이드 인

    const { width: w, height: h } = this;
    const cx = w / 2;
    const textAlpha = Math.min((elapsed - 1200) / 800, 1);

    ctx.save();
    ctx.globalAlpha = textAlpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // 한자 — 강렬한 보라 글로우
    ctx.shadowColor = "rgba(255, 160, 255, 1.0)";
    ctx.shadowBlur = 40;
    ctx.font = "bold 72px serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("無量空處", cx, h - 145);

    // 한글 부제
    ctx.shadowBlur = 20;
    ctx.font = 'bold 32px "Noto Sans KR", serif';
    ctx.fillStyle = "rgba(255, 200, 255, 0.92)";
    ctx.fillText("무량공처", cx, h - 88);

    ctx.restore();
  }
}

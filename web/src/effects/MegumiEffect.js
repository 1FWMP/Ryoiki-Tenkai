/**
 * MegumiEffect.js  v2
 * ────────────────────────────────────────────────────────────────
 * 후시구로 메구미의 영역전개 — 감합암예정(嵌合暗翳庭) 시각 효과.
 *
 * [v2 개선 사항]
 *  1. 촉수 가지치기  — 각 촉수에서 1~2개 분기 생성
 *  2. 가변 두께      — 뿌리에서 끝으로 가늘어지는 선
 *  3. 에너지 라인    — 촉수 위를 흐르는 점선(보라빛)
 *  4. 그림자 생물    — 배경에 떠도는 실루엣(윤곽선+채우기)
 *  5. 에너지 파문    — 중심에서 주기적으로 퍼지는 링
 *  6. 3계층 안개     — 근경/중경/원경 색·속도 차별화
 *  7. 강화된 귀퉁이  — 더 어둡고 넓은 그림자 퍼짐
 *  8. 중심 에너지 코어 — 내부 밝은 점 + 외부 글로우 분리
 *  9. 텍스트 연출    — 글로우 레이어 + 흰 테두리 각인 효과 + 깜빡임
 *
 * 사용법:
 *   const effect = new MegumiEffect(ctx, width, height);
 *   effect.start();
 *   // 매 프레임 — 이전에 ctx.clearRect를 호출할 필요 없음
 *   //            (내부에서 반투명 배경으로 잔상 제어)
 *   requestAnimationFrame(function loop(ts) {
 *     effect.draw(ts);
 *     requestAnimationFrame(loop);
 *   });
 *   effect.stop();
 */
export class MegumiEffect {
  /**
   * @param {CanvasRenderingContext2D} ctx    - 2D 캔버스 컨텍스트
   * @param {number}                   width  - 캔버스 너비 (px)
   * @param {number}                   height - 캔버스 높이 (px)
   */
  constructor(ctx, width, height) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.active = false;
    this.startTime = 0;
    this.tendrils = [];
    this.fogParticles = [];
    this.shadowBeings = []; // 그림자 생물 실루엣
    this.ripples = []; // 에너지 파문 링
    this._initAll();
  }

  // ── 초기화 ────────────────────────────────────────────────────

  /** 전체 요소를 초기화한다. */
  _initAll() {
    this._initTendrils();
    this._initShadowBeings();
    this.ripples = [];
  }

  /**
   * 촉수 18개를 원형으로 배치한다.
   * 각 촉수는 독립적인 최대 길이·속도·두께·가지를 가진다.
   */
  _initTendrils() {
    const COUNT = 18;
    this.tendrils = Array.from({ length: COUNT }, (_, i) => ({
      angle: (i / COUNT) * Math.PI * 2,
      length: 0,
      maxLength: Math.random() * 280 + 160, // 160~440 px
      speed: Math.random() * 3 + 1.5,
      widthBase: Math.random() * 10 + 5, // 뿌리 두께 5~15 px
      phase: Math.random() * Math.PI * 2,
      // 가지 (1~2개)
      branches: Array.from({ length: Math.floor(Math.random() * 2) + 1 }, () => ({
        splitAt: Math.random() * 0.4 + 0.45, // 부모의 45~85% 지점에서 분기
        angleOff: (Math.random() - 0.5) * 0.8,
        maxLen: Math.random() * 120 + 60,
        length: 0,
        speed: Math.random() * 2 + 1,
      })),
    }));

    this.fogParticles = Array.from({ length: 100 }, () => this._newFogParticle());
  }

  /**
   * 중심 주변에 7개의 그림자 생물 실루엣을 분산 배치한다.
   * start() 호출 시마다 재초기화된다.
   */
  _initShadowBeings() {
    const { width: w, height: h } = this;
    this.shadowBeings = Array.from({ length: 7 }, (_, i) => {
      const angle = (i / 7) * Math.PI * 2 + 0.3;
      const radius = Math.random() * (Math.min(w, h) * 0.28) + Math.min(w, h) * 0.12;
      return {
        x: w / 2 + Math.cos(angle) * radius,
        y: h / 2 + Math.sin(angle) * radius,
        scale: Math.random() * 0.6 + 0.7,
        rotation: Math.random() * Math.PI * 2,
        opacity: 0,
        targetOp: Math.random() * 0.45 + 0.15,
        delay: Math.random() * 1200 + 400, // ms
      };
    });
  }

  /**
   * 안개 파티클 하나를 새로 생성한다.
   * tier 0=근경(빠름/작음), 1=중경, 2=원경(느림/큼)
   */
  _newFogParticle() {
    const { width: w, height: h } = this;
    const tier = Math.floor(Math.random() * 3);
    const speeds = [1.8, 0.9, 0.4];
    const sizes = [Math.random() * 40 + 20, Math.random() * 80 + 40, Math.random() * 140 + 80];
    const opacities = [Math.random() * 0.5 + 0.1, Math.random() * 0.35 + 0.05, Math.random() * 0.2 + 0.02];
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * speeds[tier],
      vy: (Math.random() - 0.5) * speeds[tier],
      size: sizes[tier],
      opacity: opacities[tier],
      r: Math.floor(Math.random() * 6),
      g: Math.floor(Math.random() * 10),
      b: Math.floor(Math.random() * 30 + 10),
      life: 0,
      maxLife: Math.random() * 180 + 100,
      tier,
    };
  }

  // ── 공개 메서드 ───────────────────────────────────────────────

  /**
   * 효과를 시작(재시작)한다.
   * 모든 요소를 초기 상태로 리셋하고 주기적 파문을 스케줄한다.
   */
  start() {
    this.active = true;
    this.startTime = performance.now();
    for (const t of this.tendrils) {
      t.length = 0;
      for (const b of t.branches) b.length = 0;
    }
    this._initShadowBeings();
    this.ripples = [];
    this._scheduleRipples();
  }

  /** 효과를 정지한다. */
  stop() {
    this.active = false;
  }

  /**
   * 매 프레임 호출 — 감합암예정 효과를 캔버스에 렌더링한다.
   * @param {DOMHighResTimeStamp} timestamp - requestAnimationFrame 타임스탬프
   */
  draw(timestamp) {
    if (!this.active) return;

    const { ctx, width: w, height: h } = this;
    const elapsed = Math.max(0, timestamp - this.startTime);
    const cx = w / 2,
      cy = h / 2;
    const t = elapsed / 1000;

    // 1. 심층 배경 (반투명 누적 → 시간이 지날수록 어두워짐)
    ctx.globalCompositeOperation = "source-over";
    const bgA = Math.min(0.38 + (elapsed / 8000) * 0.12, 0.5);
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.85);
    bg.addColorStop(0, `rgba(8, 6, 18, ${bgA})`);
    bg.addColorStop(0.4, `rgba(3, 2, 10, ${bgA * 1.1})`);
    bg.addColorStop(1, `rgba(0, 0,  2, ${bgA * 1.3})`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // 2. 귀퉁이 그림자
    this._drawCornerShadows(w, h, Math.min(elapsed / 1800, 1));

    // 3. 원경 안개
    for (const fp of this.fogParticles) if (fp.tier === 2) this._updateAndDrawFog(fp);

    // 4. 그림자 생물 실루엣
    for (const sb of this.shadowBeings) {
      if (elapsed > sb.delay) {
        sb.opacity = Math.min((elapsed - sb.delay) / 1400, 1) * sb.targetOp;
        const wobble = Math.sin(t * 1.2 + sb.rotation) * 3;
        this._drawShadowBeing(sb.x + wobble, sb.y, sb.scale, sb.opacity, t + sb.rotation);
      }
    }

    // 5. 중경 안개
    for (const fp of this.fogParticles) if (fp.tier === 1) this._updateAndDrawFog(fp);

    // 6. 에너지 파문 링
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.radius += r.speed;
      r.opacity -= 0.006;
      if (r.opacity <= 0) {
        this.ripples.splice(i, 1);
        continue;
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(40, 80, 180, ${r.opacity * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 7. 촉수 + 가지
    for (const tendril of this.tendrils) {
      if (tendril.length < tendril.maxLength)
        tendril.length = Math.min(tendril.length + tendril.speed, tendril.maxLength);

      this._drawTendril(cx, cy, tendril, t);

      // 가지
      for (const branch of tendril.branches) {
        const splitDist = tendril.maxLength * branch.splitAt;
        if (tendril.length < splitDist) continue;
        if (branch.length < branch.maxLen) branch.length = Math.min(branch.length + branch.speed, branch.maxLen);

        const perpA = tendril.angle + Math.PI / 2;
        const progress = splitDist;
        const wave = Math.sin((progress / 40) * 2.8 + t * 2.2 + tendril.angle) * 22 * (splitDist / tendril.maxLength);
        const ox = cx + Math.cos(tendril.angle) * progress + Math.cos(perpA) * wave;
        const oy = cy + Math.sin(tendril.angle) * progress + Math.sin(perpA) * wave;
        this._drawTendrilFrom(
          ox,
          oy,
          tendril.angle + branch.angleOff,
          branch.length,
          tendril.widthBase * 0.45,
          t,
          tendril.phase + 1,
        );
      }
    }

    // 8. 근경 안개
    for (const fp of this.fogParticles) if (fp.tier === 0) this._updateAndDrawFog(fp);

    // 9. 중심 글로우 + 코어
    const pulse = 1 + Math.sin(t * 2.1) * 0.22;
    const innerPulse = 1 + Math.sin(t * 3.5 + 1) * 0.15;

    const cGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 130 * pulse);
    cGlow.addColorStop(0, "rgba(30, 60, 150, 0.70)");
    cGlow.addColorStop(0.35, "rgba(10, 20,  70, 0.35)");
    cGlow.addColorStop(1, "rgba(0,  0,   0,  0.00)");
    ctx.fillStyle = cGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, 130 * pulse, 0, Math.PI * 2);
    ctx.fill();

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 28 * innerPulse);
    core.addColorStop(0, "rgba(160, 200, 255, 0.90)");
    core.addColorStop(0.5, "rgba(60,  110, 220, 0.55)");
    core.addColorStop(1, "rgba(0,   0,   0,   0.00)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, 28 * innerPulse, 0, Math.PI * 2);
    ctx.fill();

  }

  // ── 내부 헬퍼 ─────────────────────────────────────────────────

  /**
   * 안개 파티클 업데이트 + 렌더링.
   * 수명이 다하거나 화면을 벗어나면 새 파티클로 교체한다.
   */
  _updateAndDrawFog(fp) {
    const { ctx, width: w, height: h } = this;
    fp.x += fp.vx;
    fp.y += fp.vy;
    fp.life++;
    if (fp.life > fp.maxLife || fp.x < -fp.size || fp.x > w + fp.size || fp.y < -fp.size || fp.y > h + fp.size) {
      Object.assign(fp, this._newFogParticle());
      return;
    }
    const alpha = Math.sin((fp.life / fp.maxLife) * Math.PI) * fp.opacity * 0.6;
    const grad = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, fp.size);
    grad.addColorStop(0, `rgba(${fp.r},${fp.g},${fp.b},${alpha})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(fp.x, fp.y, fp.size, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * 그림자 생물 실루엣 (타원 몸체 + 머리)을 그린다.
   * 미세한 흔들림으로 유기적 느낌을 표현한다.
   *
   * @param {number} x       - 중심 X
   * @param {number} y       - 중심 Y
   * @param {number} scale   - 스케일 배율
   * @param {number} opacity - 전체 불투명도
   * @param {number} t       - 시간(초) — 흔들림 위상
   */
  _drawShadowBeing(x, y, scale, opacity, t) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = opacity;

    // 몸체
    const bodyGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 38);
    bodyGrad.addColorStop(0, "rgba(5, 5, 12, 0.85)");
    bodyGrad.addColorStop(0.6, "rgba(2, 2,  8, 0.55)");
    bodyGrad.addColorStop(1, "rgba(0, 0,  0, 0.00)");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 28, 48, Math.sin(t * 0.4) * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(60, 100, 200, ${opacity * 0.4})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 머리
    ctx.beginPath();
    ctx.ellipse(0, -52 + Math.sin(t * 0.8) * 3, 16, 18, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(3, 3, 10, 0.75)";
    ctx.fill();
    ctx.strokeStyle = `rgba(50, 85, 180, ${opacity * 0.35})`;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * 네 귀퉁이에서 방사형으로 강한 어둠을 퍼뜨린다.
   *
   * @param {number} w        - 화면 너비
   * @param {number} h        - 화면 높이
   * @param {number} progress - 진행률 0.0 ~ 1.0 (2초에 걸쳐 전개)
   */
  _drawCornerShadows(w, h, progress) {
    const { ctx } = this;
    const maxR = Math.sqrt(w * w + h * h) * 0.7 * progress;
    if (maxR <= 0) return;

    for (const [x, y] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ]) {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, maxR);
      grad.addColorStop(0, "rgba(0, 0,  0, 0.90)");
      grad.addColorStop(0.35, "rgba(0, 2, 12, 0.55)");
      grad.addColorStop(0.65, "rgba(0, 1,  6, 0.25)");
      grad.addColorStop(1, "rgba(0, 0,  0, 0.00)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, maxR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 촉수 하나를 중심에서 그린다 (내부 헬퍼 래퍼).
   */
  _drawTendril(cx, cy, tendril, t) {
    this._drawTendrilFrom(cx, cy, tendril.angle, tendril.length, tendril.widthBase, t, tendril.phase);
  }

  /**
   * 임의 시작점(sx, sy)에서 촉수를 그린다.
   * - 뿌리 → 끝으로 두께가 줄어드는 구간별 선분
   * - 촉수 위 흐르는 보라빛 점선(에너지 라인)
   * - 끝부분 파란빛 글로우
   *
   * @param {number} sx        - 시작 X
   * @param {number} sy        - 시작 Y
   * @param {number} angle     - 방향 (rad)
   * @param {number} length    - 현재 길이 (px)
   * @param {number} widthBase - 뿌리 두께
   * @param {number} t         - 경과 시간(초)
   * @param {number} phase     - 파형 위상 오프셋
   */
  _drawTendrilFrom(sx, sy, angle, length, widthBase, t, phase) {
    const { ctx } = this;
    if (length <= 0) return;

    const steps = 30;
    const waveAmp = 24;
    const waveFreq = 2.6;
    const perpAngle = angle + Math.PI / 2;
    const pts = [];

    for (let s = 0; s <= steps; s++) {
      const progress = (s / steps) * length;
      const pRatio = s / steps;
      const wave = Math.sin((progress / 40) * waveFreq + t * 2.2 + phase) * waveAmp * pRatio;
      pts.push({
        x: sx + Math.cos(angle) * progress + Math.cos(perpAngle) * wave,
        y: sy + Math.sin(angle) * progress + Math.sin(perpAngle) * wave,
        w: widthBase * (1 - pRatio * 0.75), // 뿌리→끝 가늘어짐
      });
    }

    // 몸체 — 구간마다 두께 변화
    for (let s = 0; s < steps; s++) {
      const p0 = pts[s],
        p1 = pts[s + 1];
      ctx.beginPath();
      ctx.lineWidth = (p0.w + p1.w) * 0.5;
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(0, 0, 8, 0.92)";
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }

    // 에너지 라인 (점선 흐름)
    ctx.beginPath();
    ctx.lineWidth = 1.0;
    ctx.strokeStyle = "rgba(80, 60, 180, 0.28)";
    ctx.setLineDash([6, 14]);
    ctx.lineDashOffset = -t * 18;
    for (let s = 0; s <= steps; s++) {
      s === 0 ? ctx.moveTo(pts[0].x, pts[0].y) : ctx.lineTo(pts[s].x, pts[s].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 끝부분 글로우
    const ep = pts[pts.length - 1];
    const rO = widthBase * 0.3 + 3;
    const eg = ctx.createRadialGradient(ep.x, ep.y, 0, ep.x, ep.y, rO * 3.5);
    eg.addColorStop(0, "rgba(90, 140, 255, 0.90)");
    eg.addColorStop(0.4, "rgba(40,  70, 180, 0.40)");
    eg.addColorStop(1, "rgba(0,   0,   0,  0.00)");
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.arc(ep.x, ep.y, rO * 3.5, 0, Math.PI * 2);
    ctx.fill();
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
    if (elapsed <= 1500) return; // 1.5초 후 페이드 인

    const { width: w, height: h } = this;
    const cx = w / 2;
    const alpha = Math.min((elapsed - 1500) / 1000, 1);
    const t = elapsed / 1000;

    this._drawText(ctx, cx, h, alpha, t);
  }

  /**
   * 영역전개 텍스트를 렌더링한다.
   * 글로우 레이어 → 메인 → 얇은 테두리 순서로 겹쳐 각인 느낌을 낸다.
   *
   * @param {CanvasRenderingContext2D} ctx - 그릴 캔버스 컨텍스트
   * @param {number} cx    - 수평 중심
   * @param {number} h     - 화면 높이
   * @param {number} alpha - 불투명도 0~1
   * @param {number} t     - 경과 시간(초) — 깜빡임 위상
   */
  _drawText(ctx, cx, h, alpha, t) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // 미세 깜빡임
    const flicker = 0.92 + Math.sin(t * 8.3) * 0.04 + Math.sin(t * 13.7) * 0.04;
    ctx.globalAlpha = alpha * flicker;

    // 한자 — 글로우 레이어
    ctx.font = "bold 72px serif";
    ctx.shadowColor = "rgba(60, 90, 220, 0.95)";
    ctx.shadowBlur = 40;
    ctx.fillStyle = "rgba(40, 70, 200, 0.35)";
    ctx.fillText("嵌合暗翳庭", cx, h - 148);

    // 한자 — 메인
    ctx.shadowBlur = 16;
    ctx.shadowColor = "rgba(80, 120, 255, 0.80)";
    ctx.fillStyle = "#9ab5e0";
    ctx.fillText("嵌合暗翳庭", cx, h - 148);

    // 한자 — 각인 테두리
    ctx.strokeStyle = "rgba(200, 220, 255, 0.18)";
    ctx.lineWidth = 0.8;
    ctx.strokeText("嵌合暗翳庭", cx, h - 148);

    // 세퍼레이터 선
    ctx.shadowBlur = 8;
    ctx.strokeStyle = `rgba(100, 140, 220, ${alpha * 0.45})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx - 120, h - 108);
    ctx.lineTo(cx + 120, h - 108);
    ctx.stroke();

    // 한글 부제
    ctx.font = "bold 30px sans-serif";
    ctx.shadowBlur = 12;
    ctx.shadowColor = "rgba(60, 100, 220, 0.70)";
    ctx.fillStyle = "rgba(160, 195, 240, 0.85)";
    ctx.fillText("감합암예정", cx, h - 82);

    ctx.restore();
  }

  // ── 프라이빗 스케줄러 ─────────────────────────────────────────

  /**
   * 일정 간격으로 에너지 파문을 추가한다.
   * effect.stop() 호출 후에는 더 이상 스케줄되지 않는다.
   */
  _scheduleRipples() {
    if (!this.active) return;
    this.ripples.push({
      radius: 0,
      maxRadius: Math.max(this.width, this.height) * 0.55,
      opacity: 0.7,
      speed: 3.5 + Math.random() * 2,
    });
    setTimeout(() => this._scheduleRipples(), 900 + Math.random() * 600);
  }
}

/**
 * RyomenEffect.js
 * ───────────────
 * 료멘 스쿠나의 영역전개 — 복마어주자(伏魔御廚子) 시각 효과.
 *
 * 시각적 특징:
 *  - 검붉은 화염이 화면 아래에서 솟구치는 배경
 *  - 검정/붉은 저주 에너지 파티클
 *  - 방사형 문신 패턴 (스쿠나의 문신 상징)
 *  - 중심 붉은 에너지 펄스 글로우
 *  - "伏魔御廚子" / "복마어주자" 텍스트 페이드 인
 *
 * 사용법:
 *   const effect = new RyomenEffect(ctx, width, height);
 *   effect.start();
 *   // 매 프레임: effect.draw(performance.now());
 *   effect.stop();
 */
export class RyomenEffect {
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

    // 불꽃 파티클 배열 (60개)
    this.flames = [];
    // 저주 에너지 파티클 배열 (100개)
    this.particles = [];

    this._initParticles();
  }

  // ── 초기화 ──────────────────────────────────────

  /** 불꽃·저주 파티클을 초기 상태로 생성한다. */
  _initParticles() {
    this.flames = Array.from({ length: 60 }, () => this._newFlame());
    this.particles = Array.from({ length: 100 }, () => this._newParticle());
  }

  /**
   * 새 불꽃 오브젝트를 반환한다.
   * 화면 하단에서 시작하여 위쪽으로 상승한다.
   */
  _newFlame() {
    return {
      x: Math.random() * this.width,
      y: this.height + Math.random() * 80, // 하단 아래에서 시작
      size: Math.random() * 45 + 15,
      speed: Math.random() * 4 + 2,
      life: 0,
      maxLife: Math.random() * 70 + 40,
    };
  }

  /**
   * 새 저주 에너지 파티클을 반환한다.
   * 화면 전체에 무작위 분포, 위쪽으로 상승한다.
   */
  _newParticle() {
    return {
      x: Math.random() * this.width,
      y: this.height * (0.3 + Math.random() * 0.7), // 화면 하부 70% 영역
      vx: (Math.random() - 0.5) * 2.5,
      vy: -(Math.random() * 3 + 1),
      size: Math.random() * 4 + 1,
      life: 0,
      maxLife: Math.random() * 80 + 40,
      isBlack: Math.random() > 0.45, // 45%는 붉은 파티클, 나머지는 검정
    };
  }

  // ── 공개 메서드 ──────────────────────────────────

  /** 효과를 시작한다. */
  start() {
    this.active = true;
    this.startTime = performance.now();
  }

  /** 효과를 정지한다. */
  stop() {
    this.active = false;
  }

  /**
   * 매 프레임 호출 — 복마어주자 효과를 캔버스에 그린다.
   * @param {DOMHighResTimeStamp} timestamp - requestAnimationFrame 타임스탬프
   */
  draw(timestamp) {
    if (!this.active) return;

    const { ctx, width: w, height: h } = this;
    const elapsed = Math.max(0, timestamp - this.startTime);
    const cx = w / 2;
    const cy = h / 2;

    // ─ 1. 검붉은 배경 (선형 그라디언트 — 위쪽이 더 어두움) ─
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "rgba(4,  0,  0, 0.35)");
    bg.addColorStop(0.5, "rgba(25, 0,  0, 0.30)");
    bg.addColorStop(1, "rgba(55, 0,  0, 0.28)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // ─ 2. 불꽃 파티클 ─
    for (const fl of this.flames) {
      fl.y -= fl.speed;
      fl.life++;

      // 수명 초과 시 리셋
      if (fl.life > fl.maxLife) {
        Object.assign(fl, this._newFlame());
        continue;
      }

      const lifeRatio = fl.life / fl.maxLife;
      const alpha = Math.sin(lifeRatio * Math.PI) * 0.72; // 등장/소멸 스무딩
      const flameR = fl.size * (1 - lifeRatio * 0.45); // 위로 갈수록 작아짐

      // 붉은→검정 방사형 그라디언트로 화염 모양 표현
      const grad = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, flameR);
      grad.addColorStop(0, `rgba(255, 90,  0, ${alpha})`);
      grad.addColorStop(0.4, `rgba(180,  0,  0, ${alpha * 0.75})`);
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(fl.x, fl.y, flameR, 0, Math.PI * 2);
      ctx.fill();
    }

    // ─ 3. 저주 에너지 파티클 ─
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.life++;

      if (p.life > p.maxLife || p.y < 0) {
        Object.assign(p, this._newParticle());
        continue;
      }

      const lifeRatio = p.life / p.maxLife;
      const alpha = (1 - lifeRatio) * 0.85;

      ctx.fillStyle = p.isBlack
        ? `rgba(8, 0, 0, ${alpha})` // 검정 저주 에너지
        : `rgba(210, 10, 10, ${alpha})`; // 붉은 저주 에너지

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // ─ 4. 방사형 문신 패턴 (스쿠나 문신 상징) ─
    const t = elapsed / 1000;
    this._drawTattooPattern(cx, cy, t);

    // ─ 5. 중심 붉은 에너지 글로우 (박동 효과) ─
    const pulse = 1 + Math.sin(elapsed / 140) * 0.32; // 빠른 맥박
    const innerG = ctx.createRadialGradient(cx, cy, 0, cx, cy, 125 * pulse);
    innerG.addColorStop(0, "rgba(255, 40, 0, 0.85)");
    innerG.addColorStop(0.4, "rgba(140,  0, 0, 0.45)");
    innerG.addColorStop(1, "rgba(0,    0, 0, 0.00)");
    ctx.fillStyle = innerG;
    ctx.beginPath();
    ctx.arc(cx, cy, 125 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // ─ 6. 수직 스캔 라인 효과 (저주 에너지 분위기) ─
    this._drawScanLines(w, h, elapsed);

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
    if (elapsed <= 800) return; // 0.8초 후 페이드 인

    const { width: w, height: h } = this;
    const cx = w / 2;
    const textAlpha = Math.min((elapsed - 800) / 700, 1);

    ctx.save();
    ctx.globalAlpha = textAlpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255, 20, 0, 0.95)";
    ctx.shadowBlur = 30;

    // 한자 — 크고 붉게
    ctx.font = "bold 68px serif";
    ctx.fillStyle = "#ff5533";
    ctx.fillText("伏魔御廚子", cx, h - 145);

    // 한글 부제
    ctx.shadowBlur = 16;
    ctx.font = 'bold 30px "Noto Sans KR", serif';
    ctx.fillStyle = "rgba(255, 160, 100, 0.90)";
    ctx.fillText("복마어주자", cx, h - 88);

    ctx.restore();
  }

  // ── 내부 헬퍼 ────────────────────────────────────

  /**
   * 스쿠나의 문신에서 영감을 받은 방사형 선 패턴을 그린다.
   * 8개의 선이 중심에서 방사형으로 뻗어나가며,
   * 선 끝에는 작은 원 장식이 붙는다.
   *
   * @param {number} cx - 중심 X
   * @param {number} cy - 중심 Y
   * @param {number} t  - 경과 시간(초)
   */
  _drawTattooPattern(cx, cy, t) {
    const { ctx } = this;
    const numLines = 8;

    for (let i = 0; i < numLines; i++) {
      const angle = (i / numLines) * Math.PI * 2 + t * 0.18; // 천천히 회전
      const len = 200 + Math.sin(t * 2.5 + i) * 55; // 길이 진동
      const alpha = 0.38 + Math.sin(t * 1.8 + i * 0.6) * 0.22;

      // 방사형 선
      ctx.strokeStyle = `rgba(170, 0, 0, ${alpha})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
      ctx.stroke();

      // 선 끝 원 장식
      ctx.fillStyle = `rgba(255, 40, 0, ${alpha})`;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 외곽 회전 링 (저주 에너지 경계)
    ctx.strokeStyle = `rgba(200, 0, 0, 0.55)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 168 + Math.sin(t * 1.6) * 12, 0, Math.PI * 2);
    ctx.stroke();

    // 내측 이중 링
    ctx.strokeStyle = `rgba(255, 50, 0, 0.35)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 80 + Math.sin(t * 2.5 + 1) * 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * 수평 스캔 라인을 추가하여 저주 에너지 분위기를 연출한다.
   * 라인이 천천히 아래로 흐른다.
   *
   * @param {number} w       - 화면 너비
   * @param {number} h       - 화면 높이
   * @param {number} elapsed - 경과 시간(ms)
   */
  _drawScanLines(w, h, elapsed) {
    const { ctx } = this;
    const lineGap = 6; // 줄 간격 px
    const speed = 30; // px/초
    const offset = ((elapsed / 1000) * speed) % lineGap;

    ctx.strokeStyle = "rgba(100, 0, 0, 0.08)";
    ctx.lineWidth = 1;

    for (let y = -lineGap + offset; y < h; y += lineGap) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }
}

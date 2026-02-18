/**
 * EffectManager.js
 * ─────────────────
 * 각 캐릭터의 영역전개 효과 인스턴스를 관리한다.
 *
 * 특징:
 *  - 자체 requestAnimationFrame 루프를 갖지 않는다.
 *    → main.js 의 renderLoop 내부에서 draw(timestamp) 를 호출받는 방식.
 *  - 동시에 하나의 효과만 활성화된다. (새 트리거 시 기존 효과 자동 정지)
 *
 * 사용 예:
 *   const manager = new EffectManager(ctxEffect, w, h);
 *   manager.trigger('gojo');          // 영역전개 발동
 *   // 매 프레임 main renderLoop 안에서:
 *   manager.draw(timestamp);
 *   // 손이 사라지면:
 *   manager.reset();
 */

import { GojoEffect } from "./GojoEffect.js";
import { RyomenEffect } from "./RyomenEffect.js";
import { MegumiEffect } from "./MegumiEffect.js";

export class EffectManager {
  /**
   * @param {CanvasRenderingContext2D} ctx    - canvas-effect 의 2D 컨텍스트
   * @param {number}                   width  - 캔버스 너비 (px)
   * @param {number}                   height - 캔버스 높이 (px)
   */
  constructor(ctx, width, height) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;

    // 캐릭터 이름 → 효과 인스턴스 맵
    this.effects = {
      gojo: new GojoEffect(ctx, width, height),
      ryomen: new RyomenEffect(ctx, width, height),
      megumi: new MegumiEffect(ctx, width, height),
    };

    /** 현재 활성 효과 키 ('gojo' | 'ryomen' | 'megumi' | null) */
    this.activeKey = null;
  }

  // ── 공개 메서드 ──────────────────────────────────

  /**
   * 지정한 캐릭터의 영역전개를 발동한다.
   * 이미 같은 효과가 활성화된 경우 무시한다.
   *
   * @param {string} className - 'gojo' | 'ryomen' | 'megumi'
   */
  trigger(className) {
    // 같은 효과 중복 발동 방지
    if (this.activeKey === className) return;

    // 기존 효과 정지
    this._stopCurrent();

    const effect = this.effects[className];
    if (!effect) {
      console.warn(`[EffectManager] 알 수 없는 제스처 클래스: "${className}"`);
      return;
    }

    this.activeKey = className;
    effect.start();
    console.log(`[EffectManager] 영역전개 발동: ${className}`);
  }

  /**
   * main.js 의 renderLoop 안에서 매 프레임 호출한다.
   * 활성 효과가 있을 때만 캔버스를 지우고 draw() 를 실행한다.
   *
   * @param {DOMHighResTimeStamp} timestamp - requestAnimationFrame 타임스탬프
   */
  draw(timestamp) {
    if (!this.activeKey) return;

    const effect = this.effects[this.activeKey];
    if (!effect) return;

    // 이전 프레임 지우기 후 효과 렌더
    this.ctx.clearRect(0, 0, this.width, this.height);
    effect.draw(timestamp);
  }

  /**
   * 현재 활성 효과를 정지하고 캔버스를 클리어한다.
   * 손이 사라지거나 영역전개가 종료될 때 호출한다.
   */
  reset() {
    this._stopCurrent();
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /**
   * 캔버스 크기가 변경될 때 모든 효과 인스턴스의 width/height 를 갱신한다.
   * (main.js 의 resizeCanvases() 와 연동)
   *
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    this.width = width;
    this.height = height;

    for (const effect of Object.values(this.effects)) {
      effect.width = width;
      effect.height = height;
    }
  }

  // ── 내부 헬퍼 ────────────────────────────────────

  /** 현재 활성 효과를 stop() 하고 activeKey 를 null 로 초기화한다. */
  _stopCurrent() {
    if (this.activeKey && this.effects[this.activeKey]) {
      this.effects[this.activeKey].stop();
    }
    this.activeKey = null;
  }
}

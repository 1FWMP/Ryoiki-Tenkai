/**
 * GestureRecognizer.js
 * ────────────────────
 * 매 프레임 GestureModel의 추론 결과를 받아
 * "연속 N프레임 동안 같은 클래스 + 높은 신뢰도"를 충족할 때
 * 제스처 확정(confirmed) 이벤트를 발생시키는 클래스.
 *
 * 오인식 방지 목적:
 *  - 단일 프레임 돌발 결과는 무시
 *  - 안정적으로 유지된 자세만 효과 발동
 *
 * 사용 예시:
 *   const recognizer = new GestureRecognizer();
 *   recognizer.on('confirmed', ({ className, confidence }) => {
 *     effectManager.trigger(className);
 *   });
 *   recognizer.on('reset', () => {
 *     effectManager.reset();
 *   });
 *
 *   // 매 프레임
 *   recognizer.update(inferResult);
 */

import { EventEmitter } from '../utils/EventEmitter.js';

// ──────────────────────────────────────────────
// 클래스별 필요 손 개수
// collect_data.py의 CLASS_HAND_COUNT와 반드시 동일해야 한다.
//   1 = 한 손 (gojo)
//   2 = 양손 (ryomen, megumi)
//   0 = 제한 없음
// ──────────────────────────────────────────────
const REQUIRED_HANDS = {
  gojo:    1,
  ryomen:  2,
  megumi:  2,
  unknown: 0,
};

// ──────────────────────────────────────────────
// 기본 설정값
// ──────────────────────────────────────────────

const DEFAULT_OPTIONS = {
  // 제스처 확정에 필요한 연속 프레임 수 (30fps 기준 약 0.5초)
  requiredFrames: 15,

  // 제스처 확정에 필요한 최소 신뢰도 (0.0 ~ 1.0)
  minConfidence: 0.85,

  // 한 번 확정된 후 동일 제스처를 다시 확정하기까지 필요한 쿨다운 프레임
  // (같은 포즈를 계속 유지해도 효과가 반복 발동하지 않도록)
  cooldownFrames: 60,
};

// ──────────────────────────────────────────────
// GestureRecognizer 클래스
// ──────────────────────────────────────────────

export class GestureRecognizer extends EventEmitter {
  /**
   * @param {object} options - DEFAULT_OPTIONS를 오버라이드할 설정
   */
  constructor(options = {}) {
    super();
    this._opts = { ...DEFAULT_OPTIONS, ...options };

    // 현재 연속으로 감지된 클래스명 ('gojo', 'megumi', 'ryomen')
    this._currentClass  = null;

    // 현재 클래스가 연속 감지된 프레임 수
    this._frameCount    = 0;

    // 마지막으로 확정된 클래스명 (쿨다운 적용 대상)
    this._confirmedClass = null;

    // 마지막 확정 이후 경과 프레임 수
    this._cooldownCount = 0;

    // 현재 확정 상태인지 여부
    this._isConfirmed   = false;
  }

  /**
   * 매 프레임 호출해 추론 결과를 업데이트한다.
   * 조건 충족 시 'confirmed' 이벤트를 발생시킨다.
   *
   * @param {{ className: string, confidence: number }} inferResult
   *   GestureModel.infer() 또는 inferSync()의 반환값
   * @param {number} handCount - 현재 프레임에서 감지된 손 개수 (0, 1, 2)
   */
  update(inferResult, handCount = 0) {
    const { className, confidence } = inferResult;

    // 쿨다운 카운터 감소
    if (this._cooldownCount > 0) {
      this._cooldownCount--;
    }

    // ── unknown 클래스: 어떤 포즈에도 해당하지 않음 → 스트릭 초기화 ──
    // 모델이 unknown을 예측하면 이전 연속 프레임 카운트를 리셋한다.
    if (className === 'unknown') {
      this._resetStreak();
      return;
    }

    // ── 손 개수 불일치: 스트릭 초기화 ──
    // 예) gojo(1손)인데 양손 감지됨 → 리셋
    // 예) megumi(2손)인데 한 손만 감지됨 → 리셋
    const required = REQUIRED_HANDS[className] ?? 0;
    if (required > 0 && handCount !== required) {
      this._resetStreak();
      return;
    }

    // ── 신뢰도 미달: 연속 카운트 초기화 ──
    if (confidence < this._opts.minConfidence) {
      this._resetStreak();
      return;
    }

    // ── 클래스 전환: 카운트 초기화 후 새 클래스로 시작 ──
    if (className !== this._currentClass) {
      this._resetStreak();
      this._currentClass = className;
      this._frameCount   = 1;
      return;
    }

    // ── 동일 클래스 연속 감지 ──
    this._frameCount++;

    // 연속 프레임 수 및 신뢰도 충족 → 제스처 확정
    if (
      this._frameCount >= this._opts.requiredFrames &&
      !this._isConfirmed &&
      this._cooldownCount === 0
    ) {
      this._confirmGesture(className, confidence);
    }
  }

  /**
   * 손이 감지되지 않을 때 호출한다.
   * 현재 확정 상태였다면 'reset' 이벤트를 발생시켜 효과를 종료한다.
   */
  handleNoHand() {
    if (this._isConfirmed) {
      this._isConfirmed = false;

      /**
       * 'reset' 이벤트: 손이 사라져 대기 상태로 돌아왔음을 알림
       * @event GestureRecognizer#reset
       * @type {{ previousClass: string }}
       */
      this.emit('reset', { previousClass: this._confirmedClass });
    }
    this._resetStreak();
  }

  /**
   * 제스처 확정 처리.
   * @param {string} className   - 확정된 클래스명
   * @param {number} confidence  - 해당 시점의 신뢰도
   * @private
   */
  _confirmGesture(className, confidence) {
    this._isConfirmed    = true;
    this._confirmedClass = className;
    this._cooldownCount  = this._opts.cooldownFrames;

    /**
     * 'confirmed' 이벤트: 제스처가 안정적으로 확정됨
     * @event GestureRecognizer#confirmed
     * @type {{ className: string, confidence: number, frameCount: number }}
     */
    this.emit('confirmed', {
      className,
      confidence,
      frameCount: this._frameCount,
    });

    console.log(
      `[GestureRecognizer] 제스처 확정: ${className}` +
      ` (신뢰도 ${(confidence * 100).toFixed(1)}%, ${this._frameCount}프레임)`
    );
  }

  /**
   * 연속 감지 스트릭 초기화.
   * 클래스가 바뀌거나 신뢰도가 떨어지면 호출된다.
   * @private
   */
  _resetStreak() {
    this._currentClass = null;
    this._frameCount   = 0;
  }

  /**
   * 현재 연속 감지 진행 상황을 반환 (HUD 표시에 활용).
   *
   * @returns {{ currentClass: string|null, frameCount: number, progress: number }}
   *   - progress: 0.0 ~ 1.0 (requiredFrames 대비 현재 프레임 비율)
   */
  getProgress() {
    return {
      currentClass: this._currentClass,
      frameCount:   this._frameCount,
      progress:     this._frameCount / this._opts.requiredFrames,
      isConfirmed:  this._isConfirmed,
    };
  }

  /**
   * 인식기 상태 완전 초기화. (효과 종료 후 수동으로 리셋할 때 사용)
   */
  reset() {
    this._currentClass   = null;
    this._frameCount     = 0;
    this._confirmedClass = null;
    this._cooldownCount  = 0;
    this._isConfirmed    = false;
  }
}

/**
 * EventEmitter.js
 * ───────────────
 * Node.js EventEmitter와 호환되는 경량 브라우저용 이벤트 에미터.
 * GestureRecognizer 등 이벤트 기반 모듈의 기반 클래스로 사용된다.
 *
 * 지원 메서드:
 *   on(event, listener)    - 이벤트 리스너 등록
 *   off(event, listener)   - 이벤트 리스너 제거
 *   once(event, listener)  - 한 번만 실행되는 리스너 등록
 *   emit(event, ...args)   - 이벤트 발생 및 리스너 호출
 *   removeAllListeners()   - 모든 리스너 제거
 */

export class EventEmitter {
  constructor() {
    // 이벤트명 → 리스너 함수 배열 매핑
    /** @type {Map<string, Function[]>} */
    this._listeners = new Map();
  }

  /**
   * 이벤트 리스너를 등록한다.
   * @param {string}   event    - 이벤트명
   * @param {Function} listener - 콜백 함수
   * @returns {this} 메서드 체이닝 지원
   */
  on(event, listener) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(listener);
    return this;
  }

  /**
   * 이벤트 리스너를 제거한다.
   * @param {string}   event    - 이벤트명
   * @param {Function} listener - 제거할 콜백 함수 (on()에 넘긴 것과 동일 레퍼런스)
   * @returns {this}
   */
  off(event, listener) {
    if (!this._listeners.has(event)) return this;
    const updated = this._listeners.get(event).filter(fn => fn !== listener);
    this._listeners.set(event, updated);
    return this;
  }

  /**
   * 한 번만 실행되는 리스너를 등록한다.
   * 이벤트 발생 후 자동으로 제거된다.
   * @param {string}   event
   * @param {Function} listener
   * @returns {this}
   */
  once(event, listener) {
    // 래퍼 함수를 만들어 한 번 실행 후 제거
    const wrapper = (...args) => {
      listener(...args);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  /**
   * 이벤트를 발생시켜 등록된 모든 리스너를 호출한다.
   * @param {string} event    - 이벤트명
   * @param {...any} args     - 리스너에 전달할 인자
   * @returns {boolean} 리스너가 하나 이상 있었으면 true
   */
  emit(event, ...args) {
    if (!this._listeners.has(event)) return false;
    const listeners = [...this._listeners.get(event)];  // 복사본으로 순회 (리스너 내 제거 안전)
    listeners.forEach(fn => fn(...args));
    return listeners.length > 0;
  }

  /**
   * 모든 이벤트 리스너를 제거한다.
   * @param {string} [event] - 지정 시 해당 이벤트만 제거
   */
  removeAllListeners(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }
}

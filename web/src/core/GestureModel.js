/**
 * GestureModel.js
 * ───────────────
 * TensorFlow.js를 사용해 변환된 MLP 모델을 로드하고
 * 63차원 랜드마크 벡터로 제스처 클래스를 추론하는 클래스.
 *
 * 모델 파일 위치: /public/tfjs_model/model.json (Vite 개발 서버 기준)
 *
 * 사용 예시:
 *   const model = new GestureModel();
 *   await model.load();
 *   const result = await model.infer(float32Array63);
 *   // result: { classIndex: 0, className: 'gojo', confidence: 0.97 }
 */

import * as tf from "@tensorflow/tfjs";

// ──────────────────────────────────────────────
// 클래스 인덱스 매핑
// train.py의 LabelEncoder는 클래스명을 알파벳 순으로 정렬하므로
// 아래 순서는 Python의 encoder.classes_ 와 반드시 일치해야 한다.
// 학습 후 train.py 출력에서 인덱스 순서를 확인할 것.
// ──────────────────────────────────────────────
export const CLASS_NAMES = ["gojo", "megumi", "ryomen"];

// 모델 파일 경로 (Vite의 public/ 폴더 = 루트 경로로 제공)
const MODEL_URL = "/tfjs_model/model.json";

export class GestureModel {
  constructor() {
    /** @type {tf.LayersModel|null} */
    this._model = null;

    // 소프트맥스 이전 로짓값을 추출하기 위한 중간 모델
    // 마지막 레이어가 독립 Softmax/Activation이면 자동 생성, 아니면 null
    /** @type {tf.LayersModel|null} */
    this._logitsModel = null;
  }

  /**
   * TF.js 모델 파일을 네트워크에서 로드한다.
   * 앱 시작 시 한 번만 호출한다.
   *
   * @returns {Promise<void>}
   * @throws {Error} 모델 파일을 찾을 수 없을 때
   */
  async load() {
    try {
      this._model = await tf.loadLayersModel(MODEL_URL);

      // 첫 번째 추론은 웜업 (JIT 컴파일 등으로 지연이 생길 수 있음)
      // 더미 텐서로 미리 실행해 실제 추론 지연을 줄인다.
      const warmup = tf.zeros([1, 63]);
      this._model.predict(warmup).dispose();
      warmup.dispose();

      console.log("[GestureModel] 모델 로드 완료");
      console.log(`  입력 shape : ${this._model.inputs[0].shape}`);
      console.log(`  출력 shape : ${this._model.outputs[0].shape}`);

      // ── 레이어 구조 출력 ──
      const layers = this._model.layers;
      console.log("[GestureModel] 레이어 목록:");
      layers.forEach((l, i) => console.log(`  [${i}] ${l.name} (${l.getClassName()})`));

      // ── 로짓 중간 모델 생성 ──
      const lastLayer = layers[layers.length - 1];
      const lastClassName = lastLayer.getClassName();

      if (lastClassName === "Softmax" || lastClassName === "Activation") {
        // 케이스 1: 독립 Softmax/Activation 레이어 → 직전 레이어 출력이 로짓
        const logitLayer = layers[layers.length - 2];
        this._logitsModel = tf.model({
          inputs: this._model.inputs,
          outputs: logitLayer.output,
        });
        console.log(
          `[GestureModel] 로짓 중간 모델 생성 완료 (케이스1 — 독립 Softmax)` + ` / 출력 레이어: ${logitLayer.name}`,
        );
      } else if (lastClassName === "Dense") {
        // 케이스 2: Dense(activation='softmax') 내장 구조
        // → 동일 가중치를 가진 linear Dense 레이어로 로짓 재계산
        const [kernel, bias] = lastLayer.getWeights();
        const prevLayer = layers[layers.length - 2];

        // linear 활성화(= 활성화 없음)의 Dense 레이어 생성
        const linearDense = tf.layers.dense({
          units: lastLayer.units,
          activation: "linear",
          useBias: true,
        });

        // 이전 레이어 출력에 연결해 모델 구성
        const logitOutput = linearDense.apply(prevLayer.output);
        this._logitsModel = tf.model({
          inputs: this._model.inputs,
          outputs: logitOutput,
        });

        // 원래 Dense의 가중치(kernel, bias)를 그대로 복사
        linearDense.setWeights([kernel, bias]);

        console.log(
          `[GestureModel] 로짓 중간 모델 생성 완료 (케이스2 — Dense 내장 softmax)` +
            ` / 원본 레이어: ${lastLayer.name}`,
        );
      } else {
        console.warn(`[GestureModel] 알 수 없는 마지막 레이어 유형: ${lastClassName}` + " — 로짓 모델 생성 건너뜀.");
      }
    } catch (err) {
      throw new Error(
        `[GestureModel] 모델 로드 실패: ${err.message}\n` +
          "convert_to_tfjs.py를 실행해 web/public/tfjs_model/ 에 모델을 배치하세요.",
      );
    }
  }

  /**
   * 63차원 랜드마크 벡터를 입력받아 제스처 클래스를 추론한다.
   *
   * @param {Float32Array} vector - 길이 63의 정규화된 랜드마크 벡터
   * @returns {Promise<{classIndex: number, className: string, confidence: number, probabilities: Float32Array}>}
   *   - classIndex   : 예측 클래스 인덱스
   *   - className    : 예측 클래스명 ('gojo' | 'megumi' | 'ryomen')
   *   - confidence   : 예측 확률 (0.0 ~ 1.0)
   *   - probabilities: 전체 클래스 확률값 배열 (길이 3)
   */
  async infer(vector) {
    if (!this._model) {
      throw new Error("[GestureModel] load()를 먼저 호출하세요.");
    }

    // Float32Array → 2D 텐서 [1, 63] 로 변환
    const inputTensor = tf.tensor2d([Array.from(vector)], [1, 63]);

    // 추론 실행 — 결과: [1, 3] softmax 출력
    const outputTensor = this._model.predict(inputTensor);

    // 텐서 데이터를 JS 배열로 추출
    const probabilities = await outputTensor.data();

    // 추론 결과 배열 확인
    console.log("가능성: ", probabilities);
    // 사용한 텐서 메모리 즉시 해제 (TF.js는 수동 메모리 관리 필요)
    inputTensor.dispose();
    outputTensor.dispose();

    // argmax: 확률이 가장 높은 클래스 인덱스 결정
    let classIndex = 0;
    let maxProb = probabilities[0];
    for (let i = 1; i < probabilities.length; i++) {
      if (probabilities[i] > maxProb) {
        maxProb = probabilities[i];
        classIndex = i;
      }
    }

    return {
      classIndex,
      className: CLASS_NAMES[classIndex],
      confidence: maxProb,
      probabilities: new Float32Array(probabilities),
    };
  }

  /**
   * 동기 방식 추론. requestAnimationFrame 루프에서 async/await 없이 사용할 때 활용.
   * tf.tidy()로 텐서 자원을 자동 정리한다.
   *
   * @param {Float32Array} vector - 길이 63의 정규화된 랜드마크 벡터
   * @returns {{ classIndex: number, className: string, confidence: number, probabilities: Float32Array }}
   */
  inferSync(vector) {
    if (!this._model) {
      throw new Error("[GestureModel] load()를 먼저 호출하세요.");
    }

    // tf.tidy: 콜백 내에서 생성된 중간 텐서를 자동으로 dispose
    const probabilities = tf.tidy(() => {
      const input = tf.tensor2d([Array.from(vector)], [1, 63]);
      const output = this._model.predict(input);
      return output.dataSync(); // 동기적으로 Float32Array 반환
    });

    // ── 소프트맥스 이전 로짓값 출력 ──
    if (this._logitsModel) {
      const logits = tf.tidy(() => {
        const input = tf.tensor2d([Array.from(vector)], [1, 63]);
        return this._logitsModel.predict(input).dataSync();
      });
      console.log(
        "[GestureModel] logits (pre-softmax):",
        CLASS_NAMES.map((name, i) => `${name}: ${logits[i].toFixed(4)}`).join(", "),
      );
    }

    // 최고 확률 클래스 결정
    let classIndex = 0;
    let maxProb = probabilities[0];
    for (let i = 1; i < probabilities.length; i++) {
      if (probabilities[i] > maxProb) {
        maxProb = probabilities[i];
        classIndex = i;
      }
    }

    return {
      classIndex,
      className: CLASS_NAMES[classIndex],
      confidence: maxProb,
      probabilities: new Float32Array(probabilities),
    };
  }

  /** 모델이 로드되었는지 여부 */
  get isLoaded() {
    return this._model !== null;
  }
}

/**
 * vite.config.js
 * ──────────────
 * Vite 빌드 도구 설정 파일.
 *
 * 주요 설정:
 *  - TFJS/MediaPipe WASM 파일을 위한 헤더 추가
 *    (SharedArrayBuffer 사용 시 COOP/COEP 헤더 필요)
 *  - public/ 폴더는 빌드 시 그대로 dist/에 복사됨
 *    (tfjs_model/ 접근: /tfjs_model/model.json)
 */

import { defineConfig } from 'vite';

export default defineConfig({
  // 개발 서버 설정
  server: {
    port: 5173,
    // MediaPipe WASM 및 TF.js SharedArrayBuffer 사용을 위한 보안 헤더 설정
    // COOP: Cross-Origin-Opener-Policy
    // COEP: Cross-Origin-Embedder-Policy
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  // 빌드 출력 설정
  build: {
    outDir: 'dist',
    // 번들 크기가 큰 TF.js/MediaPipe 경고 임계값 상향 (기본 500KB)
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        // TF.js와 MediaPipe를 별도 청크로 분리해 초기 로딩 성능 개선
        manualChunks: {
          tensorflow: ['@tensorflow/tfjs'],
          mediapipe:  ['@mediapipe/tasks-vision'],
        },
      },
    },
  },

  // 최적화: TF.js의 대용량 패키지를 사전 번들링에서 제외
  // (CDN 로딩이 아닌 npm 패키지를 직접 사용하므로 주석 처리)
  // optimizeDeps: {
  //   exclude: ['@tensorflow/tfjs', '@mediapipe/tasks-vision'],
  // },
});

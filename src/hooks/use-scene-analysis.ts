'use client';

import type { AnalysisPhase } from '@/types';
import type { SceneAnalysisResult } from '@/types/scene';
import { useCallback, useState } from 'react';

// ─── API 요청/응답 계약 타입 ────────────────────────────────────────────────

/**
 * POST /api/analyze-scene 요청 body 형태.
 * 변환·파싱은 서버에서 전담하므로 클라이언트는 이미지 원본만 전달한다.
 */
type SceneAnalyzeRequest = {
  /** "data:" 접두사 없는 순수 base64 문자열 */
  imageBase64: string;
  mimeType: string;
};

/**
 * POST /api/analyze-scene 성공 응답 body 형태.
 * 서버가 Gemini 응답을 파싱·정규화해 SceneDetection[] 형태로 내려준다.
 */
type SceneAnalyzeResponse = {
  sceneDetections: SceneAnalysisResult['sceneDetections'];
};

// ─── 내부 유틸 함수 ──────────────────────────────────────────────────────────

/**
 * File 객체를 순수 base64 문자열로 변환한다.
 *
 * FileReader.readAsDataURL()은 "data:image/jpeg;base64,AAAA..." 형태로 반환하는데,
 * Gemini API는 "data:" 접두사 없이 순수 base64만 받는다.
 * 따라서 쉼표(,) 이후 부분만 잘라낸다.
 *
 * @param file - 변환할 이미지 File
 * @returns 순수 base64 문자열 (Promise)
 */
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // "data:image/jpeg;base64," 이후의 순수 base64 부분만 추출
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () =>
      reject(new Error('이미지 파일을 읽는 데 실패했습니다.'));
    reader.readAsDataURL(file);
  });

/**
 * File 객체에서 이미지의 실제 픽셀 너비/높이를 측정한다.
 *
 * Gemini bounding box를 픽셀 좌표로 변환할 때 원본 이미지 크기가 필요하다.
 * File 객체만으로는 크기를 알 수 없으므로, HTMLImageElement에 로드한 뒤 측정한다.
 *
 * @param file - 크기를 측정할 이미지 File
 * @returns { width, height } 픽셀 단위 (Promise)
 */
const parseImageDimensions = (
  file: File,
): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(objectUrl);
    };
    img.onerror = () => {
      reject(new Error('이미지 크기를 측정하는 데 실패했습니다.'));
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
  });

// ─── 훅 ─────────────────────────────────────────────────────────────────────

/** useSceneAnalysis 훅이 반환하는 값의 타입 */
type UseSceneAnalysisReturn = {
  /** 현재 분석 단계 ('idle' | 'loading' | 'done' | 'error') */
  phase: AnalysisPhase;
  /** 분석 완료 시 결과. 아직 분석 전이거나 오류 시 null */
  result: SceneAnalysisResult | null;
  /** phase === 'error'일 때 사용자에게 보여줄 오류 메시지 */
  errorMessage: string | null;
  /** 풍경 분석 실행. 완료 시 결과를 반환하고, 실패 시 null을 반환한다. */
  runSceneAnalysis: (imageFile: File) => Promise<SceneAnalysisResult | null>;
};

/**
 * 풍경(Scene) 모드 이미지 분석 훅.
 *
 * 이미지를 Next.js API Route(/api/analyze-scene)로 전송하고,
 * 서버가 Gemini 2.0 Flash Vision API를 통해 감지한 객체 목록을 받아
 * SceneAnalysisResult 형태로 반환한다.
 *
 * @returns { phase, result, errorMessage, runSceneAnalysis }
 */
export function useSceneAnalysis(): UseSceneAnalysisReturn {
  const [phase, setPhase] = useState<AnalysisPhase>('idle');
  const [result, setResult] = useState<SceneAnalysisResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const runSceneAnalysis = useCallback(
    async (imageFile: File): Promise<SceneAnalysisResult | null> => {
      setPhase('loading');
      setResult(null);
      setErrorMessage(null);

      try {
        // 이미지를 base64로 변환 + 원본 크기 측정 (병렬 실행)
        const [imageBase64, { width: imageWidth, height: imageHeight }] =
          await Promise.all([
            fileToBase64(imageFile),
            parseImageDimensions(imageFile),
          ]);

        const requestBody: SceneAnalyzeRequest = {
          imageBase64,
          mimeType: imageFile.type,
        };

        const response = await fetch('/api/analyze-scene', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            (errorData as { message?: string }).message ??
              `서버 오류가 발생했습니다. (HTTP ${response.status})`,
          );
        }

        // 서버가 이미 SceneDetection[] 형태로 정제해 반환하므로 바로 사용한다.
        const { sceneDetections }: SceneAnalyzeResponse = await response.json();

        const sceneResult: SceneAnalysisResult = {
          sceneDetections,
          imageWidth,
          imageHeight,
        };

        setResult(sceneResult);
        setPhase('done');
        return sceneResult;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : '알 수 없는 오류가 발생했습니다.';
        setErrorMessage(message);
        setPhase('error');
        return null;
      }
    },
    [],
  );

  return { phase, result, errorMessage, runSceneAnalysis };
}

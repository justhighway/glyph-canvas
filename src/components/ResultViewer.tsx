'use client';

import { useEffect, useState } from 'react';

import type { AnalysisResult } from '@/types';

type ResultViewerProps = {
  imageFile: File;
  analysisResult: AnalysisResult | null;
  isRendering: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
};

/**
 * 원본 이미지와 분석 결과 Canvas를 겹쳐서 보여주는 뷰어.
 * Canvas는 이미지와 동일한 크기로 그 위에 절대 위치로 배치된다.
 * 실제 글자 렌더링은 use-canvas-render 훅이 canvasRef를 통해 수행한다.
 */
export function ResultViewer({
  imageFile,
  analysisResult,
  isRendering,
  canvasRef,
}: ResultViewerProps) {
  const [imageObjectUrl, setImageObjectUrl] = useState<string>('');

  useEffect(() => {
    /**
     * Strict Mode에서는 effect가 마운트 → 언마운트 → 재마운트 순으로 두 번 실행된다.
     * useMemo + cleanup 조합은 첫 언마운트에서 URL을 해제한 뒤 재마운트 시 이미 해제된
     * URL을 <img>가 참조해 이미지가 깨진다.
     * useState + effect로 URL을 생성하고, cleanup에서 해제하면 재마운트 시 새 URL이
     * 생성되므로 안전하다.
     */
    const url = URL.createObjectURL(imageFile);
    setImageObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  return (
    <figure className='relative w-full'>
      {/*
       * 원본 이미지 — Canvas 크기의 기준이 되는 레이어.
       * 렌더링 완료 후(analysisResult 존재)에는 invisible로 숨긴다.
       * display:none을 쓰면 figure 높이가 사라져 Canvas가 0px이 되므로
       * visibility:hidden으로 공간은 유지하되 화면에서만 안 보이게 한다.
       */}
      {imageObjectUrl && (
        <img
          src={imageObjectUrl}
          alt='사용자가 업로드한 분석 대상 이미지'
          className={`w-full h-auto rounded-xl block ${analysisResult ? 'invisible' : ''}`}
        />
      )}

      {/*
       * Canvas는 항상 DOM에 존재해야 한다.
       * analysisResult 조건부로 렌더링하면 renderGlyphs 호출 시점에 canvasRef.current가
       * null이어서 그리기가 실행되지 않는다.
       */}
      <canvas
        ref={canvasRef}
        className='absolute top-0 left-0 w-full h-auto rounded-xl'
        style={{ display: analysisResult ? 'block' : 'none' }}
      />

      {/* 분석/렌더링 중 오버레이 — aria-live로 스크린 리더에 상태 변화를 전달한다 */}
      {isRendering && (
        <output
          aria-live='polite'
          aria-label='렌더링 진행 중'
          className='absolute inset-0 flex items-center justify-center rounded-xl bg-zinc-950/70'
        >
          <span className='flex flex-col items-center gap-3'>
            {/* 스피너는 순수 시각 장식이므로 스크린 리더가 읽지 않도록 한다 */}
            <span
              aria-hidden='true'
              className='size-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin'
            />
            <p className='text-sm text-zinc-400'>분석 중...</p>
          </span>
        </output>
      )}
    </figure>
  );
}

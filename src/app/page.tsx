'use client';

import { useRef, useState, useCallback } from 'react';

import type { AnalysisMode, AnalysisResult, Language } from '@/types';
import { DEFAULT_ANALYSIS_MODE, DEFAULT_LANGUAGE } from '@/constants/config';

import { ModeSelector } from '@/components/ModeSelector';
import { ImageUploader } from '@/components/ImageUploader';
import { ResultViewer } from '@/components/ResultViewer';
import { ControlPanel } from '@/components/ControlPanel';

import { usePortraitAnalysis } from '@/hooks/use-portrait-analysis';
import { useSceneAnalysis } from '@/hooks/use-scene-analysis';
import { useCanvasRender } from '@/hooks/use-canvas-render';

/**
 * 앱의 단일 페이지. 모든 전역 상태와 훅을 조립하는 최상위 컴포넌트.
 *
 * 상태 흐름:
 * 1. 사용자가 이미지를 선택하면 handleImageFileSelect 호출
 * 2. 선택된 모드의 분석 훅을 실행
 * 3. 분석 완료 후 renderGlyphs로 Canvas에 렌더링
 */
export default function GlyphCanvasPage() {
  const [selectedMode, setSelectedMode] = useState<AnalysisMode>(DEFAULT_ANALYSIS_MODE);
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(DEFAULT_LANGUAGE);
  const [uploadedImageFile, setUploadedImageFile] = useState<File | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  // 분석~렌더링 전 구간을 하나의 플래그로 관리한다.
  // 각 훅의 phase를 조합하면 업로드 직후 ~ 훅 내부 setPhase 호출 전 사이 gap이 생긴다.
  const [isProcessing, setIsProcessing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { analysisPhase: portraitPhase, runPortraitAnalysis } = usePortraitAnalysis();
  const { phase: scenePhase, runSceneAnalysis } = useSceneAnalysis();
  const { phase: renderPhase, renderGlyphs } = useCanvasRender();

  const currentPhase = selectedMode === 'portrait' ? portraitPhase : scenePhase;

  const handleImageFileSelect = useCallback(
    async (imageFile: File): Promise<void> => {
      setIsProcessing(true);
      setUploadedImageFile(imageFile);
      setAnalysisResult(null);

      let result: AnalysisResult | null = null;

      try {
        if (selectedMode === 'portrait') {
          const portraitData = await runPortraitAnalysis(imageFile);
          if (portraitData) result = { mode: 'portrait', data: portraitData };
        } else {
          const sceneData = await runSceneAnalysis(imageFile);
          if (sceneData) result = { mode: 'scene', data: sceneData };
        }

        if (result) {
          setAnalysisResult(result);
          // React 리렌더링 후 Canvas가 DOM에 반영될 때까지 한 프레임 양보한다.
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          await renderGlyphs(canvasRef, imageFile, result, selectedLanguage);
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [selectedMode, selectedLanguage, runPortraitAnalysis, runSceneAnalysis, renderGlyphs],
  );

  const handleModeChange = useCallback((mode: AnalysisMode): void => {
    setSelectedMode(mode);
    setUploadedImageFile(null);
    setAnalysisResult(null);
  }, []);

  const handleLanguageChange = useCallback(
    async (language: Language): Promise<void> => {
      setSelectedLanguage(language);
      // 분석 결과가 이미 있으면 새 언어로 즉시 재렌더링한다.
      if (uploadedImageFile && analysisResult) {
        await renderGlyphs(canvasRef, uploadedImageFile, analysisResult, language);
      }
    },
    [uploadedImageFile, analysisResult, renderGlyphs],
  );

  const handleDownloadPng = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const anchor = document.createElement('a');
    anchor.href = canvas.toDataURL('image/png');
    anchor.download = 'glyph-canvas.png';
    anchor.click();
  }, []);

  const handleResetToIdle = useCallback((): void => {
    setUploadedImageFile(null);
    setAnalysisResult(null);
  }, []);

  return (
    <main className='min-h-screen bg-zinc-950 text-zinc-100'>
      <div className='mx-auto max-w-xl px-4 py-12 flex flex-col gap-8'>

        <header className='flex flex-col gap-1'>
          <h1 className='text-2xl font-bold tracking-tight'>글자그림</h1>
          <p className='text-sm text-zinc-400'>
            이미지를 업로드하면 객체를 감지해 그 이름으로 영역을 채웁니다.
          </p>
        </header>

        <ModeSelector
          selectedMode={selectedMode}
          analysisPhase={isProcessing ? 'loading' : currentPhase}
          onModeChange={handleModeChange}
        />

        {!uploadedImageFile ? (
          <ImageUploader
            onImageFileSelect={handleImageFileSelect}
            disabled={isProcessing}
          />
        ) : (
          <ResultViewer
            imageFile={uploadedImageFile}
            analysisResult={analysisResult}
            isRendering={isProcessing}
            canvasRef={canvasRef}
          />
        )}

        {uploadedImageFile && (
          <ControlPanel
            language={selectedLanguage}
            analysisPhase={isProcessing ? 'loading' : currentPhase}
            onLanguageChange={handleLanguageChange}
            onDownloadPng={handleDownloadPng}
            onResetToIdle={handleResetToIdle}
          />
        )}

      </div>
    </main>
  );
}

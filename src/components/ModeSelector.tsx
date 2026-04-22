'use client';

import { AnalysisMode, AnalysisPhase } from '@/types';

import { Button } from './ui/button';

type ModeSelectorProps = {
  selectedMode: AnalysisMode;
  analysisPhase: AnalysisPhase;
  onModeChange: (mode: AnalysisMode) => void;
};

const ANALYSIS_MODES: { mode: AnalysisMode; label: string }[] = [
  { mode: 'portrait', label: '인물' },
  { mode: 'scene', label: '풍경' },
];

/**
 * * 인물/풍경 모드를 선택하는 토글 컴포넌트
 * * 분석 진행 중(loading)에는 모드 변경을 막아 분석 결과가 중간에 날아가지 않도록 함
 */
export function ModeSelector({
  selectedMode,
  analysisPhase,
  onModeChange,
}: ModeSelectorProps) {
  const isDisabled = analysisPhase === 'loading';

  return (
    <div>
      {ANALYSIS_MODES.map(({ mode, label }) => (
        <Button
          key={mode}
          variant={selectedMode === mode ? 'default' : 'outline'}
          size='sm'
          disabled={isDisabled}
          onClick={() => onModeChange(mode)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

'use client';

import { AnalysisPhase, Language } from '@/types';

import { Button } from './ui/button';

type ControlPanelProps = {
  language: Language;
  analysisPhase: AnalysisPhase;
  onLanguageChange: (language: Language) => void;
  onDownloadPng: () => void;
  onResetToIdle: () => void;
};

type LanguageOption = {
  language: Language;
  label: string;
};

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { language: 'ko', label: '한국어' },
  { language: 'en', label: 'English' },
  { language: 'jp', label: '日本語' },
];

export function ControlPanel({
  language,
  analysisPhase,
  onLanguageChange,
  onDownloadPng,
  onResetToIdle,
}: ControlPanelProps) {
  const isDisabled = analysisPhase === 'loading';

  return (
    <section aria-label='결과 제어 패널' className='flex flex-col gap-4 w-full'>
      <div role='group' aria-label='언어 선택' className='flex gap-2'>
        {LANGUAGE_OPTIONS.map(({ language: lang, label }) => (
          <Button
            key={lang}
            variant={language === lang ? 'default' : 'outline'}
            size={'sm'}
            disabled={isDisabled}
            aria-pressed={language === lang}
            onClick={() => onLanguageChange(lang)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div role='group' aria-label='결과 저장 및 초기화' className='flex gap-2'>
        <Button
          variant='default'
          size='sm'
          disabled={isDisabled}
          aria-label='결과 이미지를 PNG 파일로 다운로드'
          onClick={onDownloadPng}
        >
          PNG 저장
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={isDisabled}
          aria-label='처음으로 돌아가 새 이미지 업로드'
          onClick={onResetToIdle}
        >
          다시 시작
        </Button>
      </div>
    </section>
  );
}

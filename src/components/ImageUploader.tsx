'use client';

import {
  ALLOWED_IMAGE_MIME_TYPE_SET,
  MAX_IMAGE_FILE_SIZE_BYTES,
} from '@/constants/config';
import { ChangeEvent, DragEvent, KeyboardEvent, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

type ImageUploaderProps = {
  onImageFileSelect: (imageFile: File) => void;
  /** 분석 진행 중에는 업로드 비활성화 */
  disabled: boolean;
};

type ValidationRule = {
  test: (file: File) => boolean;
  message: string;
};

const IMAGE_FILE_VALIDATION_RULES: ValidationRule[] = [
  {
    test: (file) => !ALLOWED_IMAGE_MIME_TYPE_SET.has(file.type),
    message: 'JPG, PNG, WEBP 파일만 업로드할 수 있습니다.',
  },
  {
    test: (file) => file.size > MAX_IMAGE_FILE_SIZE_BYTES,
    message: '10MB 미만의 이미지를 업로드해주세요.',
  },
];

/**
 * 파일 검증 실패 시 첫 번째 실패 규칙의 에러 메시지를 반환한다.
 * 모든 규칙을 통과하면 null을 반환한다.
 */
const validateImageFile = (file: File): string | null =>
  IMAGE_FILE_VALIDATION_RULES.find(({ test }) => test(file))?.message ?? null;

/**
 * 드래그앤드롭 또는 클릭으로 이미지 파일을 선택하는 업로드 영역.
 * 파일 형식과 크기를 클라이언트에서 먼저 검증해 불필요한 서버 요청을 막는다.
 */
export function ImageUploader({
  onImageFileSelect,
  disabled,
}: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [validationErrorMessage, setValidationErrorMessage] = useState<
    string | null
  >(null);

  /** 검증 후 통과한 파일만 부모로 전달하는 단일 진입점 */
  const processSelectedFile = (file: File): void => {
    const errorMessage = validateImageFile(file);
    if (errorMessage) {
      setValidationErrorMessage(errorMessage);
      return;
    }
    setValidationErrorMessage(null);
    onImageFileSelect(file);
  };

  const handleClick = (): void => fileInputRef.current?.click();

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') handleClick();
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    // preventDefault가 없으면 브라우저가 drop 이벤트를 막는다
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (): void => setIsDragOver(false);

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragOver(false);
    const [file] = event.dataTransfer.files;
    if (file) processSelectedFile(file);
  };

  const handleFileInputChange = (
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    const [file] = event.target.files ?? [];
    if (file) processSelectedFile(file);
  };

  return (
    <div className='flex flex-col items-center gap-3 w-full'>
      <div
        role='button'
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={disabled ? undefined : handleClick}
        onDragOver={disabled ? undefined : handleDragOver}
        onDragLeave={disabled ? undefined : handleDragLeave}
        onDrop={disabled ? undefined : handleDrop}
        onKeyDown={disabled ? undefined : handleKeyDown}
        className={cn(
          'flex flex-col items-center justify-center gap-3',
          'w-full h-48 rounded-xl border-2 border-dashed',
          'transition-colors cursor-pointer select-none',
          isDragOver
            ? 'border-violet-500 bg-violet-500/10'
            : 'border-zinc-700 hover:border-violet-500 hover:bg-zinc-900',
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        )}
      >
        <span className='text-3xl'>📁</span>
        <p className='text-sm text-zinc-400 text-center'>
          이미지를 드래그하거나 클릭해서 업로드
          <br />
          <span className='text-xs text-zinc-600'>
            JPG · PNG · WEBP · 최대 10MB
          </span>
        </p>
      </div>

      {validationErrorMessage && (
        <p className='text-sm text-red-400'>{validationErrorMessage}</p>
      )}

      {/* 실제 파일 선택은 숨긴 input으로 처리하고, 클릭 이벤트로만 제어한다 */}
      <input
        ref={fileInputRef}
        type='file'
        accept='image/jpeg,image/png,image/webp'
        className='hidden'
        onChange={handleFileInputChange}
      />
    </div>
  );
}

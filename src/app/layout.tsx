import './globals.css';

import { Noto_Sans, Noto_Sans_JP, Noto_Sans_KR } from 'next/font/google';

import type { Metadata } from 'next';

const notoSans = Noto_Sans({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-noto-sans',
  display: 'swap',
});

const notoSansKr = Noto_Sans_KR({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-noto-sans-kr',
  display: 'swap',
});

const notoSansJp = Noto_Sans_JP({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-noto-sans-jp',
  display: 'swap',
});

export const metadata: Metadata = {
  title: '글자그림 | Glyph Art',
  description:
    '이미지 속 객체를 감지해, 각 영역을 그 객체의 이름(글자)으로 채우는 Semantic Typography Art 생성기.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang='ko'
      className={`${notoSansKr.variable} ${notoSans.variable} ${notoSansJp.variable}`}
    >
      <body className='min-h-full flex flex-col'>{children}</body>
    </html>
  );
}

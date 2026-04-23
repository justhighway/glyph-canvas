# Vite → Next.js 마이그레이션 기록

## 마이그레이션 배경

초기 프로젝트는 Vite + React로 구성된 순수 클라이언트 사이드 앱이었다. 아키텍처 변경 결과 풍경 모드에서 Gemini API를 서버에서 호출해야 한다는 요구가 생겼다. 이유는 하나다. Gemini API 키를 클라이언트 코드에 넣으면 브라우저 개발자 도구로 누구나 꺼내 쓸 수 있다. API 키를 서버에서만 보관하고 서버가 대신 API를 호출해주는 구조가 필요했다.

이를 위해 서버 코드를 추가하는 방법을 검토했다.

---

## 왜 Next.js를 선택했는가

### 검토한 대안

**Vite + Express 별도 서버**

프론트(Vite)와 백엔드(Express)를 완전히 분리하는 구조다. 두 서버를 따로 배포해야 하므로 배포 파이프라인이 두 개가 된다. Express 서버를 Railway, Render 같은 서비스에 올리면 무료 플랜에서 15분 비활성 시 슬립 상태로 전환되고, 첫 요청 시 30초 이상 대기가 발생한다. 이 앱의 서버 역할이 API 키를 숨기고 Gemini를 호출하는 단 하나의 엔드포인트인데, 그것을 위해 별도 서버를 운영하는 건 과도한 구조다.

**Vite + Cloudflare Workers**

Cloudflare Workers는 무료 티어가 넉넉하고(일 10만 요청), 슬립 없이 전 세계 엣지에서 실행된다. 기술적으로 좋은 선택이지만, Workers는 Node.js가 아닌 V8 기반으로 일부 Node.js API를 지원하지 않는다. Gemini SDK가 Workers 환경에서 동작하는지 별도 검증이 필요하고, 문제가 생겼을 때 레퍼런스가 적다.

**Next.js + Vercel**

Next.js는 API Route 기능을 통해 프론트엔드 코드 옆에 서버 코드를 함께 둘 수 있다. `app/api/analyze-scene/route.ts` 파일 하나가 서버리스 함수로 자동 배포된다. 단일 레포, 단일 배포 파이프라인이다. Vercel 무료 티어에서 서버리스 함수는 요청이 없을 때 비용이 0이고, 슬립 없이 즉시 실행된다. Next.js + Vercel은 이 구성의 공식 호스팅 조합이라 레퍼런스가 풍부하다.

### 결정 근거

이 앱에서 서버가 하는 일은 딱 하나, Gemini API 키를 숨기고 대신 호출해주는 것이다. 그 한 가지 역할을 위해 가장 단순한 구조를 선택하는 것이 KISS 원칙에 맞다. Next.js API Route는 그 역할에 가장 딱 맞는 최소한의 선택이었다.

---

## 마이그레이션 방법

Vite 설정과 Next.js 설정이 충돌하므로 점진적 마이그레이션 대신 초기화 후 재설치를 선택했다. 보존해야 할 파일이 `src/types/`, `src/constants/` 등 소수였기 때문이다.

1. 보존 파일(`src/types/`, `src/constants/`, `CLAUDE.md`, `specs/`, `memory/`)을 임시 위치로 이동
2. 프로젝트 루트 전체 초기화
3. `pnpm create next-app@latest` 로 Next.js 16 신규 설치
4. 보존 파일 복원

### 설치 옵션

```bash
pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-turbopack --import-alias "@/*"
```

| 옵션 | 이유 |
|------|------|
| `--app` | App Router 사용 (Pages Router는 레거시) |
| `--src-dir` | `src/` 폴더 구조 — 기존 스펙 폴더 구조와 일치 |
| `--no-turbopack` | 안정적인 webpack 번들러 사용 |
| `--import-alias "@/*"` | `@/components/...` 형태의 절대 경로 import |

---

## Vite 대비 주요 변경사항

| 항목 | Vite | Next.js |
|------|------|---------|
| 진입점 | `src/main.tsx` | `src/app/layout.tsx` + `src/app/page.tsx` |
| 환경 변수 | `import.meta.env.VITE_*` | `process.env.*` (서버), `process.env.NEXT_PUBLIC_*` (클라이언트) |
| 서버 코드 | 불가 | `app/api/*/route.ts` |
| 폰트 | 직접 import | `next/font/google` (빌드 타임 번들링) |
| 이미지 | `<img>` | `next/image` (최적화 자동) |
| 빌드 | `vite build` | `next build` |
| 개발 서버 | `vite` | `next dev` |

---

## 프로젝트 구조 변화

```
# 이전 (Vite)
src/
├── App.tsx          # 루트 컴포넌트
├── main.tsx         # ReactDOM.createRoot 진입점
└── index.css

# 이후 (Next.js App Router)
src/
└── app/
    ├── layout.tsx   # 루트 레이아웃 (폰트, 메타데이터, 전역 HTML)
    ├── page.tsx     # 메인 페이지 (전역 상태)
    ├── globals.css
    └── api/
        └── analyze-scene/
            └── route.ts  # Gemini API 호출 서버 엔드포인트
```

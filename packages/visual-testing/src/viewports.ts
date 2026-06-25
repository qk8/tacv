export const VIEWPORTS = {
  mobile:     { width: 375,  height: 812,  label: 'iPhone 14'      },
  mobile_lg:  { width: 428,  height: 926,  label: 'iPhone 14 Plus' },
  tablet:     { width: 768,  height: 1024, label: 'iPad'           },
  desktop:    { width: 1280, height: 720,  label: 'Desktop HD'     },
  widescreen: { width: 1440, height: 900,  label: 'Desktop FHD'    },
} as const;

export type ViewportKey = keyof typeof VIEWPORTS;
export const ALL_VIEWPORTS = Object.entries(VIEWPORTS) as Array<[ViewportKey, typeof VIEWPORTS[ViewportKey]]>;

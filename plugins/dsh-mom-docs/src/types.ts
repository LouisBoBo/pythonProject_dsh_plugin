export const MOM_CODES = [
  'ok',
  'directory_invalid',
  'filename_invalid',
  'content_empty',
  'content_too_large',
  'write_failed',
] as const

export type MomCode = (typeof MOM_CODES)[number]

export class MomError extends Error {
  readonly code: Exclude<MomCode, 'ok'>

  constructor(code: Exclude<MomCode, 'ok'>, message: string) {
    super(message)
    this.name = 'MomError'
    this.code = code
  }
}

export type SaveResult = {
  filePath: string
  relativePath: string
  fileName: string
  date: string
  bytes: number
  title: string
  indexWritten: boolean
}

export type ListedDoc = {
  fileName: string
  bytes: number
  title: string
  savedAt: string
}

export type LibraryFile = {
  fileName: string
  title: string
  bytes: number
  savedAt: string
  mtimeMs: number
  kind: 'md' | 'txt'
}

export type LibraryDay = {
  date: string
  items: LibraryFile[]
}

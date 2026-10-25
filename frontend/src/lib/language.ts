/** The product supports English only, including existing devices with older preferences. */
const KEY = 'tmm-language'

export const LANGUAGES = [
  { id: 'en', label: 'english' },
] as const

export type LanguageId = (typeof LANGUAGES)[number]['id']

export function getPreferredLanguage(): LanguageId {
  return 'en'
}

export function setPreferredLanguage(id: LanguageId) {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // English does not depend on access to device storage.
  }
}

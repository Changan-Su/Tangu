// Thin typed access to the preload bridge (window.amadeus).
import type { AmadeusApi } from '@amadeus-shared/ipc'

export const amadeus: AmadeusApi = window.amadeus

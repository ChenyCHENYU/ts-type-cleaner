import type { UserInfo, Status } from './types'

export function getUser(): UserInfo {
  return { id: 1, name: 'test' }
}

export function getStatus(): Status {
  return 'active'
}

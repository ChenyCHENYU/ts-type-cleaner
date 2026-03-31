export interface UserInfo {
  id: number
  name: string
}

export type Status = 'active' | 'inactive'

interface UnusedLocal {
  foo: string
}

export enum Role {
  Admin = 'admin',
  User = 'user'
}

// 以下类型均未导出，但都在本文件内被真实使用——不得报 unused

interface BaseShape {
  id: number
}

interface ExtendedShape extends BaseShape {
  name: string
}

enum LocalMode {
  On = 1,
  Off = 2,
}

const modeMap: Record<number, string> = {
  [LocalMode.On]: 'on',
  [LocalMode.Off]: 'off',
}

export const shape = null as unknown as ExtendedShape
export const modes = modeMap

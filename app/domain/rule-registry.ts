export interface VersionedRuleEngine<Input, Output> {
  readonly version: string
  readonly schemaVersion: number
  evaluate(input: Input): Output
}

export class RuleRegistry<Input, Output> {
  readonly #engines = new Map<string, VersionedRuleEngine<Input, Output>>()
  #currentVersion: string
  #previousVersion: string | null = null

  constructor(initial: VersionedRuleEngine<Input, Output>) {
    this.#engines.set(initial.version, initial)
    this.#currentVersion = initial.version
  }

  install(
    engine: VersionedRuleEngine<Input, Output>,
    validate: (engine: VersionedRuleEngine<Input, Output>) => void,
  ): void {
    if (this.#engines.has(engine.version))
      throw new Error(`规则版本已存在：${engine.version}`)
    validate(engine)
    this.#engines.set(engine.version, engine)
    this.#previousVersion = this.#currentVersion
    this.#currentVersion = engine.version
  }

  current(): VersionedRuleEngine<Input, Output> {
    return this.#engines.get(this.#currentVersion)!
  }

  previous(): VersionedRuleEngine<Input, Output> | null {
    return this.#previousVersion
      ? (this.#engines.get(this.#previousVersion) ?? null)
      : null
  }

  rollback(): VersionedRuleEngine<Input, Output> {
    if (!this.#previousVersion) throw new Error('没有可回退的规则版本')
    const oldCurrent = this.#currentVersion
    this.#currentVersion = this.#previousVersion
    this.#previousVersion = oldCurrent
    return this.current()
  }
}

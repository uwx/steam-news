declare namespace doT {
  function template(
    tmpl: string,
    cfg?: Partial<TemplateSettings>,
    def?: Definitions
  ): TemplateFunction

  function compile(tmpl: string, def?: Definitions): TemplateFunction

  function setDelimiters({start, end}: Delimiters): void

  type TemplateSettings = {
    argName: string | string[]
    encoders: {
      [key: string]: Encoder
    }
    selfContained?: false
    strip: boolean
    internalPrefix: string
    encodersPrefix: string
    delimiters: Delimiters
  } | {
    argName: string | string[]
    encoders: {
      [key: string]: string
    }
    selfContained: true
    strip: boolean
    internalPrefix: string
    encodersPrefix: string
    delimiters: Delimiters
  };

  type TemplateFunction = (data: any) => string

  interface Definitions {
    [key: string]: string | Function | any
  }

  type Encoder = (data: any) => string

  type Delimiters = {
    start: string
    end: string
  }
}

export = doT

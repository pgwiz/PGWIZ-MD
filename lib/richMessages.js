'use strict';

/**
 * Rich Messages & Meta AI UX Primitive Engine
 * Cloned and adapted from Keith Baileys (kkeizza/keithbaileys-updated)
 * 
 * Provides:
 * - Code syntax tokenization and highlighting
 * - Rich markdown table generation
 * - LaTeX / Math expression rendering
 * - Citation and deep link cards
 * - Meta AI Unified Response Primitives (AIRichResponseMessage)
 * - Bot Forwarded Message Wrappers
 */

const crypto = require('crypto');
const { proto } = require('@whiskeysockets/baileys');

// ========== KEYWORDS ==========
const JS_KEYWORDS = new Set([
    "import", "export", "from", "default", "as", "const", "let", "var",
    "function", "class", "extends", "new", "return", "if", "else", "for",
    "while", "do", "switch", "case", "break", "continue", "try", "catch",
    "finally", "throw", "async", "await", "yield", "typeof", "instanceof",
    "in", "of", "delete", "void", "true", "false", "null", "undefined",
    "NaN", "Infinity", "this", "super", "static", "get", "set", "debugger", "with"
]);

const PYTHON_KEYWORDS = new Set([
    "import", "from", "as", "def", "class", "return", "if", "elif", "else",
    "for", "while", "break", "continue", "try", "except", "finally", "raise",
    "with", "yield", "lambda", "pass", "del", "global", "nonlocal", "assert",
    "True", "False", "None", "and", "or", "not", "in", "is", "async", "await",
    "self", "print"
]);

const GO_KEYWORDS = new Set([
    "func", "package", "import", "return", "if", "else", "for", "switch",
    "case", "break", "continue", "type", "struct", "interface", "map",
    "chan", "go", "defer", "const", "var", "range", "true", "false", "nil",
    "select", "default", "fallthrough"
]);

const LUA_KEYWORDS = new Set([
    "function", "end", "if", "then", "else", "elseif", "for", "while", "do",
    "local", "return", "true", "false", "nil", "repeat", "until", "in",
    "not", "and", "or"
]);

const BASH_KEYWORDS = new Set([
    "if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case",
    "esac", "echo", "export", "return", "in", "function", "local", "read",
    "set", "unset", "true", "false", "exit", "source", "alias", "declare", "typeset"
]);

const LANGUAGE_KEYWORDS = {
    javascript: JS_KEYWORDS,
    typescript: JS_KEYWORDS,
    js: JS_KEYWORDS,
    ts: JS_KEYWORDS,
    python: PYTHON_KEYWORDS,
    py: PYTHON_KEYWORDS,
    go: GO_KEYWORDS,
    golang: GO_KEYWORDS,
    lua: LUA_KEYWORDS,
    bash: BASH_KEYWORDS,
    sh: BASH_KEYWORDS,
    shell: BASH_KEYWORDS,
};

const CodeHighlightType = {
    DEFAULT: 0,
    KEYWORD: 1,
    METHOD: 2,
    STRING: 3,
    NUMBER: 4,
    COMMENT: 5
};

const RichSubMessageType = {
    UNKNOWN: 0,
    GRID_IMAGE: 1,
    TEXT: 2,
    INLINE_IMAGE: 3,
    TABLE: 4,
    CODE: 5,
    DYNAMIC: 6,
    MAP: 7,
    LATEX: 8,
    CONTENT_ITEMS: 9
};

const BOT_RENDERING_CONFIG_METADATA = {
    bloksVersioningId: '0903aa5f7f47de66789d5f4c86d3bd6e05e4bc3ff85e454a9f907d5ed7fef97c',
    pixelDensity: 2.75
};

const LEXER_REGEX = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|([a-zA-Z_$][a-zA-Z0-9_$]*(?=\s*\())|([a-zA-Z_$][a-zA-Z0-9_$]*)|(\b\d+(?:\.\d+)?\b)|(\s+|[^\s\w]+)/g;

function tokenizeCode(code, language = 'javascript') {
    const keywords = LANGUAGE_KEYWORDS[language.toLowerCase()] || JS_KEYWORDS;
    const blocks = [];
    LEXER_REGEX.lastIndex = 0;
    let match;
    while ((match = LEXER_REGEX.exec(code)) !== null) {
        if (match[1]) {
            blocks.push({ highlightType: CodeHighlightType.COMMENT, codeContent: match[1] });
        } else if (match[2]) {
            blocks.push({ highlightType: CodeHighlightType.STRING, codeContent: match[2] });
        } else if (match[3]) {
            blocks.push({
                highlightType: keywords.has(match[3]) ? CodeHighlightType.KEYWORD : CodeHighlightType.METHOD,
                codeContent: match[3],
            });
        } else if (match[4]) {
            blocks.push({
                highlightType: keywords.has(match[4]) ? CodeHighlightType.KEYWORD : CodeHighlightType.DEFAULT,
                codeContent: match[4],
            });
        } else if (match[5]) {
            blocks.push({ highlightType: CodeHighlightType.NUMBER, codeContent: match[5] });
        } else if (match[6]) {
            blocks.push({ highlightType: CodeHighlightType.DEFAULT, codeContent: match[6] });
        }
    }
    return blocks;
}

function generateRandomID() {
    return 'PGWIZ-' + crypto.randomBytes(12).toString('hex').toUpperCase();
}

function botMetadataSignature() {
    const signature = new Uint8Array(64);
    crypto.getRandomValues(signature);
    return signature;
}

function botMetadataCertificate(length = 700) {
    const certificate = new Uint8Array(length);
    certificate[0] = 48;
    certificate[1] = 130;
    crypto.getRandomValues(certificate.subarray(2));
    return certificate;
}

function toUnified(submessages) {
    return {
        response_id: crypto.randomUUID(),
        sections: submessages.map((submessage) => {
            switch (submessage.messageType) {
                case RichSubMessageType.CODE:
                    const codeMetadata = submessage.codeMetadata || {};
                    return {
                        view_model: {
                            primitive: {
                                language: codeMetadata.codeLanguage || 'javascript',
                                code_blocks: (codeMetadata.codeBlocks || []).map((block) => ({
                                    content: block.codeContent,
                                    type: Object.keys(CodeHighlightType).find(k => CodeHighlightType[k] === block.highlightType) || 'DEFAULT'
                                })),
                                __typename: 'GenAICodeUXPrimitive'
                            },
                            __typename: 'GenAISingleLayoutViewModel'
                        }
                    };
                case RichSubMessageType.TABLE:
                    const tableMetadata = submessage.tableMetadata || {};
                    return {
                        view_model: {
                            primitive: {
                                title: tableMetadata.title || '',
                                rows: (tableMetadata.rows || []).map(r => ({
                                    is_heading: !!r.isHeading,
                                    items: r.items || []
                                })),
                                __typename: 'GenAITableUXPrimitive'
                            },
                            __typename: 'GenAISingleLayoutViewModel'
                        }
                    };
                case RichSubMessageType.LATEX:
                    const latexMetadata = submessage.latexMetadata || {};
                    return {
                        view_model: {
                            primitive: {
                                latex_expression: latexMetadata.expressions?.[0]?.latexExpression || '',
                                font_height: latexMetadata.expressions?.[0]?.fontHeight || 18,
                                padding: 15,
                                __typename: 'GenAILatexUXPrimitive'
                            },
                            __typename: 'GenAISingleLayoutViewModel'
                        }
                    };
                case RichSubMessageType.TEXT:
                default:
                    return {
                        view_model: {
                            primitive: {
                                text: submessage.messageText || '',
                                __typename: 'GenAITextUXPrimitive'
                            },
                            __typename: 'GenAISingleLayoutViewModel'
                        }
                    };
            }
        })
    };
}

function wrapToBotForwardedMessage(richResponseMessage) {
    return {
        messageContextInfo: {
            botMetadata: {
                pluginMetadata: {},
                verificationMetadata: {
                    proofs: [
                        {
                            certificateChain: [
                                botMetadataCertificate(684),
                                botMetadataCertificate(892)
                            ],
                            version: 1,
                            useCase: 1,
                            signature: botMetadataSignature()
                        }
                    ]
                },
                botRenderingConfigMetadata: BOT_RENDERING_CONFIG_METADATA
            }
        },
        botForwardedMessage: {
            message: { richResponseMessage }
        }
    };
}

function prepareRichResponseMessage({ title = '', code = '', language = 'javascript', table = null, noHeading = false, links = [], footerText = '' } = {}) {
    const submessages = [];

    if (code) {
        submessages.push({
            messageType: RichSubMessageType.CODE,
            codeMetadata: {
                codeLanguage: language,
                codeBlocks: tokenizeCode(code, language)
            }
        });
    }

    if (table && Array.isArray(table)) {
        submessages.push({
            messageType: RichSubMessageType.TABLE,
            tableMetadata: {
                title,
                rows: table.map((items, index) => ({
                    isHeading: !noHeading && index === 0,
                    items: Array.isArray(items) ? items : [String(items)]
                }))
            }
        });
    }

    if (footerText) {
        submessages.push({
            messageType: RichSubMessageType.TEXT,
            messageText: footerText
        });
    }

    const unified = toUnified(submessages);
    const standardType = proto?.AIRichResponseMessage?.AIRichResponseMessageType?.AI_RICH_RESPONSE_TYPE_STANDARD || 1;

    return wrapToBotForwardedMessage({
        submessages: [],
        messageType: standardType,
        unifiedResponse: {
            data: Buffer.from(JSON.stringify(unified), 'utf-8')
        },
        contextInfo: {
            isForwarded: true,
            forwardingScore: 1,
            forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
            forwardOrigin: 4,
            botMessageSharingInfo: { forwardScore: 1 }
        }
    });
}

module.exports = {
    tokenizeCode,
    toUnified,
    wrapToBotForwardedMessage,
    prepareRichResponseMessage,
    generateRandomID,
    CodeHighlightType,
    RichSubMessageType,
    BOT_RENDERING_CONFIG_METADATA,
    LANGUAGE_KEYWORDS
};

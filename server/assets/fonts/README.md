# Statement CJK font

Subset of Noto Sans CJK SC Regular (SIL OFL 1.1, see OFL.txt), renamed SemiflyStatementCJK.
Source: https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf
Source SHA-256: 2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b

Contains ASCII, yen sign, and characters in server/src/vip-statement-pdf.mjs. PDF content accepts only fixed Chinese labels and anonymized ASCII codes, never customer names. Extend the subset when adding new Chinese labels. Built with FontTools 4.69.1, retain_gids=True; the runtime embeds this font without accessing a network or system fonts.

/* Public model cards + official repository metadata, checked 2026-11-27.
   Weight bytes sum *.safetensors only, decimal GB; never a RAM/VRAM requirement. */
window.SemiflyModelBackground={
 'deepseek-flash':{
  scale:'552B 主干 · 8B / 16B 激活',architecture:'MoE · CED 编码器／解码器',parameters:'552B 主干 + 196B Engram 条件记忆',active:'预填充 8B；解码 16B',weights:'510.30 GB',precision:'官方混合精度权重',training:'45T 多模态预训练 Token',license:'MIT',
  note:'主干、条件记忆和仓库张量计数口径不同，不能把 552B 当作全部权重总量。激活参数区分输入预填充与输出解码。',
  history:[['2026-09-10','V4.1-Flash 发布','引入原生图像理解与新结构。'],['2026-10-17','1017 版本更新','API 名称保持 deepseek-flash，官方版本更新。'],['2026-11-13','应用 API 扩展','官方新增搜索、文件等服务；平台支持范围另行确认。']],
  source:'https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash',historySource:'https://api-docs.deepseek.com/zh-cn/updates/',revision:'314113f8a7dadb388215396ba5fbee2c610a04d6'
 },
 'glm-5.3':{
  scale:'753.33B 仓库张量 · 1M 上下文',architecture:'MoE · GLM-MoE-DSA',parameters:'753.33B（仓库张量统计）',active:'本次官方资料未确认',weights:'755.63 GB',precision:'FP8 为主，含 BF16 / F32',training:'本次官方资料未确认',license:'GLM-5.3 专用许可',
  note:'753.33B 来自官方仓库 Safetensors 元数据，不冒充技术报告的主干参数口径。激活参数未找到本型号明确披露，不沿用前代数字。',
  history:[['基础模型','沿用 GLM-5.2 基座','官方说明升级来自后训练。'],['当前版本','强化复杂编程与长程任务','仅文本输入，始终思考。'],['2026-11-27','资料核对','核对官方模型页和公开权重仓库；仓库创建日不当作发布日期。']],
  source:'https://huggingface.co/zai-org/GLM-5.3',historySource:'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3',revision:'ba32f8c19c8738e2c57c71798c601d477a7bf844'
 },
 'glm-5.3-flash':{
  scale:'320B 总参数 · 18B 激活',architecture:'MoE · 稀疏与线性注意力混合',parameters:'320B（官方模型介绍口径）',active:'18B / Token',weights:'328.34 GB',precision:'FP8 为主，含 BF16 / F32',training:'30T 多模态预训练 Token',license:'MIT',
  note:'320B 为官方介绍的总参数量；仓库张量统计约 321.32B，口径不同。原生多模态能力不等于平台已接通所有输入形式。',
  history:[['模型系列','GLM-5 首个原生多模态型号','使用新训练的基座，并非仅给 GLM-5.3 加上视觉接口。'],['结构变化','混合注意力与 mHC','围绕长上下文成本和计算效率设计。'],['2026-11-27','资料核对','平台已确认文本与图片输入，其他输入形式需确认。']],
  source:'https://huggingface.co/zai-org/GLM-5.3-Flash',historySource:'https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash',revision:'46a050bec13002ad29ee795c16e61cf4fa3c4a9c'
 }
};

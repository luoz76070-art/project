// Synthetic contract shared by mobile, rollout and native/app-server tests.
export const ordinaryPrompts = [
  'You are a code reviewer. Check this module.',
  '  You are helping me review this module.\nKeep the answer short.  ',
  'Knowledge cutoff: explain what this field means.',
  '你是一名代码审查员，请检查这个模块。',
  'Please check this module.',
  'Explain <environment_context> and # AGENTS.md instructions.',
  '```text\n<INSTRUCTIONS>\nquoted example\n</INSTRUCTIONS>\n```',
  'You are a code reviewer. Check this module.\n\n已上传附件：\n- example.ts | /synthetic/uploads/example.ts',
];

export const contextEnvelopes = [
  ...['environment_context', 'permissions instructions', 'app-context', 'collaboration_mode',
    'personality_spec', 'skills_instructions', 'plugins_instructions', 'INSTRUCTIONS']
    .map(tag => `<${tag}>\nsynthetic injected context\n</${tag}>`),
  '# AGENTS.md instructions for /synthetic\n\n<INSTRUCTIONS>\nsynthetic instructions\n</INSTRUCTIONS>',
  '<send_user_message_question_reply>\n[{"answer":"synthetic answer"}]\n</send_user_message_question_reply>',
];

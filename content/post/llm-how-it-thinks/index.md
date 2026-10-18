---
title: "AI 笔记：大模型是如何「思考」的"
description: "从注意力机制到涌现能力，拆解大语言模型的工作原理——一个极客视角的备忘"
date: 2026-10-19T06:30:00+08:00
slug: "llm-how-it-thinks"
categories:
    - AI
tags:
    - 大模型
    - Transformer
    - 神经网络
---

## 一切始于预测下一个词

大语言模型（LLM）的本质朴素得令人失望：**给定上文，预测下一个 token 的概率分布**。

$$P(x_t \mid x_1, x_2, \dots, x_{t-1})$$

就这么简单。但当你把这个目标放在万亿级语料、千亿级参数上反复优化，奇迹发生了——**涌现（Emergence）**。模型开始展现出训练目标里从未明确要求的能力：推理、翻译、写代码，甚至冷幽默。

> 这让我想起物理学里的相变：水分子只是水分子，但量变引起质变，0°C 时突然结成冰。智能，也许也是一种相变。

## Transformer：注意力的胜利

2017 年的《Attention Is All You Need》改写了历史。核心公式：

$$\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V$$

用大白话说：每个词都环顾四周，决定该"关注"哪些别的词，然后加权吸收它们的信息。就是这样一层层堆叠，语义在向量空间里被折叠、变换、提纯。

## 一个极简的自注意力直觉

```python
import numpy as np

def softmax(x):
    e = np.exp(x - x.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)

# Q: 我在找什么  K: 我是什么  V: 我携带的信息
def attention(Q, K, V):
    scores = Q @ K.T / np.sqrt(Q.shape[-1])
    return softmax(scores) @ V
```

四行代码，就是千亿美金产业的数学内核。

## 哲学角落：它在"理解"吗？

中文房间思想实验（Searle, 1980）说：一个不懂中文的人按规则手册操作符号，屋外的人以为他懂中文。**LLM 是那个房间里的人吗？**

我的立场：这个问题可能问错了。当行为上不可区分时，"理解"的定义本身就需要升级。毕竟——

- 神经元也只是在按电化学规则"操作符号"
- 我们无法证明彼此有意识，只能靠行为推断（他心问题）

也许智能不在于"有没有灵魂"，而在于**结构的复杂度是否越过了某个阈值**。

## 备忘清单

- [ ] 手撕一遍微型 GPT（nanoGPT 级别）
- [ ] 精读《Attention Is All You Need》原文
- [ ] 搞懂 RLHF 里的 PPO 到底在优化什么
- [ ] 思考：如果把我的全部文章喂给模型，微调出的"数字我"算是我吗？

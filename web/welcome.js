/* Universe welcome page. Customer and enterprise workspaces are rendered by identity.js. */
(() => {
  'use strict';
  const $=selector=>document.querySelector(selector);
  function entryViews(){
    $('#login-view').innerHTML=`<div class="welcome-page">
  <header class="welcome-header">
    <a class="welcome-brand" href="#universe" aria-label="semifly.ai 首页"><img src="pinapi-wordmark.svg" alt="semifly.ai"><span>It’s Your <em class="brand-ai">A</em>P<em class="brand-ai">I</em>.</span></a>
    <nav aria-label="欢迎页导航"><a href="#market">模型广场 <span data-icon="arrow-up-right"></span></a><a href="#docs">文档</a><a href="#workspace">工作台</a><div data-account-slot><a class="live-signin" href="#workspace"><span data-icon="user-round"></span>登录 / 注册</a></div><div class="universe-clock"><span>北京时间</span><time id="universe-clock" aria-live="off">--:--:--.---</time></div></nav>
  </header>
  <main class="welcome-main">
    <div class="universe-scene" aria-hidden="true"><canvas id="universe-canvas"></canvas><div class="universe-nebula"></div><div id="solar-bodies"></div><div class="universe-near-world"></div></div>
    <div class="universe-caption" aria-hidden="true"><span>太阳系 · 动态示意</span><span>ANDROMEDA / 仙女星系</span></div>
    <section class="welcome-story" aria-labelledby="welcome-title">

      <div class="welcome-copy"><h1 id="welcome-title">让灵感，<br><span>起飞一下。</span><svg class="welcome-underline" viewBox="0 0 440 24" aria-hidden="true"><path d="M5 15Q195 -3 429 12M125 21Q270 10 432 17"/></svg></h1><p><span class="universe-description">从一束灵感，去往更大的世界。<br>下一次发现，从这里开始。</span></p></div>
      <div class="welcome-story-foot"><div class="solar-control"><div class="solar-control-caption"><label for="solar-speed">宇宙运行速度</label><output id="solar-speed-value" for="solar-speed">0.10×</output></div><input id="solar-speed" type="range" min="0" max="1000" step="1" value="137" aria-label="宇宙运行速度" aria-valuetext="0.10 倍" style="--speed-progress:13.7%"><div class="solar-control-ticks" aria-hidden="true"><span>0.05×</span><span>8×</span></div></div><span class="solar-state" id="solar-state" role="status">公转中</span><button class="welcome-motion" type="button" data-welcome-motion aria-pressed="false" aria-label="暂停天体公转"><span data-motion-label>暂停公转</span></button></div>
    </section>
    <section class="welcome-entry" aria-labelledby="welcome-entry-title">
      <div class="welcome-entry-inner">

        <h2 id="welcome-entry-title">从这里出发。</h2>
        <p class="welcome-entry-lead">一个账号，个人和企业都能用。</p>
        <div class="welcome-personal-choice">
                    <h3>为你的想法，找到好模型。</h3>
          <p>选模型、充值和使用都在工作台。企业成员登录后，按权限看到自己的额度或团队管理。</p>
          <a class="welcome-continue" id="welcome-continue" href="#workspace"><span id="welcome-continue-label">登录 / 注册</span><span class="welcome-continue-arrow" data-icon="arrow-right"></span></a>
          <p class="welcome-preview-note">个人和企业用同一个账号，登录后按权限显示功能。</p>
        </div>
        <div class="welcome-explore"><span>还想先看看？</span><a href="#market">逛逛模型广场 <span data-icon="arrow-up-right"></span></a></div>
      </div>

    </section>
  </main>
  <footer class="welcome-footer"><span>semifly · 为好想法多走一步</span><span>深圳市格洛可半导体有限公司</span></footer>
</div>
`;
  }
  document.addEventListener('click', event => {
    const button=event.target.closest('[data-welcome-motion]');
    if(!button)return;
    const paused=$('.welcome-page').classList.toggle('welcome-motion-paused');
    button.setAttribute('aria-pressed',String(paused));
    button.setAttribute('aria-label',paused?'播放装饰动效':'暂停装饰动效');
    button.querySelector('[data-motion-label]').textContent=paused?'播放动效':'暂停动效';
    window.UniverseScene?.setPaused(paused);
  });
  entryViews();
  switchView(location.hash.slice(1));
})();

/**
 * Interactive CLI Interface
 * Displays incoming messages, translations, suggestions
 * and accepts user commands to select/edit/generate replies
 */
const readline = require('readline');
const chalk = require('chalk');

const DIVIDER = '─'.repeat(72);

function formatTime(timestamp) {
  const d = new Date(timestamp * 1000);
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function wordWrap(text, maxLen = 68) {
  if (!text) return '';
  const lines = [];
  let current = '';

  for (const char of text) {
    if (current.length >= maxLen && char === ' ') {
      lines.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.join('\n   ');
}

class CLI {
  constructor() {
    this.rl = null;
    this.currentMsg = null;
    this.currentSuggestions = [];
    this.currentTranslation = '';
    this.queue = [];
    this.processing = false;
    this.running = false;

    // For user input resolution
    this.resolveInput = null;
  }

  start() {
    console.log(chalk.bold.cyan(`
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   ${chalk.bold.yellow('WhatsApp Sales Assistant')}                                  ║
║   ${chalk.dim('AI-Powered Translation & Reply Copilot')}                            ║
║                                                                      ║
║   ${chalk.dim('Translate · Generate · Close Deals')}                                 ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
`));

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('> '),
    });
    this.running = true;
  }

  /**
   * Display an incoming customer message with translation and suggestions
   */
  displayIncoming(msg) {
    const body = msg.body || '';
    const translation = msg.translation || '⏳ Translating...';
    const suggestions = msg.suggestions || [];
    const contact = msg.contactName || 'Unknown';
    const number = msg.contactNumber || '';

    console.log(chalk.dim(`\n${DIVIDER}`));
    console.log(chalk.cyan.bold(`📩 CUSTOMER: ${contact}`) + (number ? chalk.dim(` (+${number})`) : ''));
    console.log(chalk.dim(`   Time: ${formatTime(msg.timestamp)}`));

    console.log(chalk.dim('\n💬 ') + chalk.white.bold('ORIGINAL:'));
    console.log(chalk.white(`   ${wordWrap(body)}`));

    console.log(chalk.dim('\n🌐 ') + chalk.yellow.bold('TRANSLATION:'));
    console.log(chalk.yellow(`   ${wordWrap(translation)}`));

    if (suggestions.length > 0) {
      console.log(chalk.dim('\n💡 ') + chalk.green.bold('SUGGESTED REPLIES:'));

      const labels = [
        chalk.blue('[Professional]'),
        chalk.magenta('[Friendly]'),
        chalk.red('[Closing]'),
      ];

      suggestions.forEach((s, i) => {
        const label = labels[i] || `[Option ${i + 1}]`;
        const preview = s.length > 60 ? s.substring(0, 60) + '...' : s;
        console.log(chalk.green(`   [${i + 1}] `) + label + ` ${chalk.white(preview)}`);
      });
    }

    console.log(chalk.dim(`\n   Commands:  `) +
      chalk.green('/1 /2 /3') + chalk.dim(' send  |  ') +
      chalk.yellow('/v1 /v2 /v3') + chalk.dim(' view  |  ') +
      chalk.cyan('/e1 /e2 /e3') + chalk.dim(' edit  |  ') +
      chalk.magenta('/c <prompt>') + chalk.dim(' custom  |  ') +
      chalk.dim('/s skip  |  /q quit'));
    console.log(chalk.dim(`${DIVIDER}\n`));
  }

  /**
   * Update suggestions for the current message (called after AI completes)
   */
  updateSuggestions(suggestions) {
    this.currentSuggestions = suggestions;
  }

  /**
   * Update translation for the current message
   */
  updateTranslation(translation) {
    this.currentTranslation = translation;
  }

  /**
   * Show a status message
   */
  showStatus(text) {
    console.log(chalk.dim(`  ℹ️  ${text}`));
  }

  /**
   * Show an error message
   */
  showError(text) {
    console.log(chalk.red(`  ❌ ${text}`));
  }

  /**
   * Show a success message
   */
  showSuccess(text) {
    console.log(chalk.green(`  ✅ ${text}`));
  }

  /**
   * Prompt user for action on the current message.
   * Returns a Promise that resolves with an action object.
   */
  prompt(msg) {
    this.currentMsg = msg;
    this.currentSuggestions = msg.suggestions || [];
    this.currentTranslation = msg.translation || '';

    return new Promise((resolve) => {
      this.resolveInput = resolve;
      this.rl.prompt();
    });
  }

  /**
   * Process one line of user input
   */
  handleInput(line) {
    // Guard: ignore input when no active prompt (no message to process)
    if (!this.resolveInput) {
      if (line.trim()) {
        console.log(chalk.dim('  ℹ️  Waiting for a customer WhatsApp message...'));
      }
      this.rl.prompt();
      return;
    }

    const input = line.trim().toLowerCase();

    // Helper to resolve and clear
    const resolve = (action) => {
      const cb = this.resolveInput;
      this.resolveInput = null;
      cb(action);
    };

    // Handle /q (quit)
    if (input === '/q' || input === ':q') {
      resolve({ action: 'quit' });
      return;
    }

    // Handle /s (skip) or empty
    if (input === '/s' || input === '' || input === ':s') {
      resolve({ action: 'skip' });
      return;
    }

    // Handle /1, /2, /3 (send suggestion)
    const sendMatch = input.match(/^\/?(\d)$/);
    if (sendMatch && !input.startsWith('v') && !input.startsWith('e')) {
      const idx = parseInt(sendMatch[1], 10) - 1;
      if (idx >= 0 && idx < this.currentSuggestions.length) {
        const text = this.currentSuggestions[idx];
        resolve({ action: 'send', text });
        return;
      }
    }

    // Handle /v1, /v2, /v3 (view full)
    const viewMatch = input.match(/^\/v(\d)$/);
    if (viewMatch) {
      const idx = parseInt(viewMatch[1], 10) - 1;
      if (idx >= 0 && idx < this.currentSuggestions.length) {
        console.log(chalk.white(`\n   Full text:\n   ${wordWrap(this.currentSuggestions[idx])}\n`));
        this.rl.prompt();
        return;
      }
    }

    // Handle /e1, /e2, /e3 (edit then send)
    const editMatch = input.match(/^\/e(\d)$/);
    if (editMatch) {
      const idx = parseInt(editMatch[1], 10) - 1;
      if (idx >= 0 && idx < this.currentSuggestions.length) {
        const original = this.currentSuggestions[idx];
        console.log(chalk.dim(`\n   Original: ${wordWrap(original)}`));
        console.log(chalk.cyan('   Enter your edited version (or empty to cancel):'));

        // Clear resolveInput to prevent double-fire during rl.question
        const savedResolve = this.resolveInput;
        this.resolveInput = null;

        this.rl.question(chalk.cyan('   > '), (edited) => {
          if (edited.trim()) {
            savedResolve({ action: 'send', text: edited.trim() });
          } else {
            console.log(chalk.dim('   ✖ Canceled\n'));
            // Re-establish the prompt
            this.resolveInput = savedResolve;
            this.rl.prompt();
          }
        });
        return;
      }
    }

    if (input.startsWith('/c ') || input.startsWith(':c ')) {
      const prompt = line.trim().substring(3).trim();
      if (prompt) {
        resolve({ action: 'custom', prompt });
        return;
      }
      // Empty prompt after /c — fall through to prompt user below
      // (re-route to bare /c handler above logic by simulating)
    }

    // Handle /c alone or /c with empty prompt
    if (input === '/c' || input === ':c' || input.startsWith('/c ') || input.startsWith(':c ')) {
      console.log(chalk.cyan('\n   Enter your custom reply instruction:'));
      console.log(chalk.dim('   (e.g., "告诉客户价格可以打9折，但需要本周下单")\n'));

      const savedResolve = this.resolveInput;
      this.resolveInput = null;

      this.rl.question(chalk.cyan('   > '), (prompt) => {
        if (prompt.trim()) {
          savedResolve({ action: 'custom', prompt: prompt.trim() });
        } else {
          console.log(chalk.dim('   ✖ Canceled\n'));
          this.resolveInput = savedResolve;
          this.rl.prompt();
        }
      });
      return;
    }

    // Any other text: treat as direct send
    resolve({ action: 'send', text: line.trim() });
  }

  /**
   * Start the interactive loop (attach line listeners after readline is created)
   */
  startLoop() {
    this.rl.on('line', (line) => {
      this.handleInput(line);
    });

    this.rl.on('close', () => {
      this.running = false;
      if (this.resolveInput) {
        this.resolveInput({ action: 'quit' });
      }
    });
  }

  /**
   * Cleanup
   */
  close() {
    this.running = false;
    if (this.rl) {
      this.rl.close();
    }
  }
}

module.exports = { CLI };

# Phase 1 Self-Check Testing Plan

> Historical note: this Phase 1 self-check plan preserves early implementation assumptions. Current Phase 2 direction is defined by `docs/PROJECT-BACKGROUND-AND-ROADMAP.md`, `docs/HANDOVER.md`, and `docs/superpowers/specs/2026-06-19-phase2-personality-relationship-memory-assets-design.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comprehensive self-check of Phase 1 implementation before user testing. Verify all components, fix bugs, and ensure production readiness.

**Architecture:** Multi-layer testing approach - code review → static analysis → unit logic checks → integration tests → manual E2E verification.

**Tech Stack:** TypeScript compiler checks, manual testing, bug fixes as discovered.

**Scope:** Review all 14 implemented tasks, test all user workflows, fix any issues found.

---

## Overview

This plan systematically checks every component built in Phase 1:
1. **Code Review** - Review logic, types, error handling
2. **Static Analysis** - TypeScript compilation, linting
3. **Component Testing** - Test each service/store/component
4. **Integration Testing** - Test full workflows
5. **Bug Fixes** - Fix any issues discovered
6. **Documentation Updates** - Update docs with findings

---

## Task 1: Code Review - Service Layer

**Files:**
- Review: `src/services/interfaces.ts`
- Review: `src/services/llm/types.ts`
- Review: `src/services/llm/openai.ts`
- Review: `src/services/llm/index.ts`
- Review: `src/services/config/index.ts`

- [ ] **Step 1: Review interfaces.ts for completeness**

Check:
- All Message fields defined correctly
- LLMService interface methods match implementation
- ChatParams/ChatResponse types complete
- LLMConfig provider union includes all options

- [ ] **Step 2: Review OpenAI adapter error handling**

Read: `src/services/llm/openai.ts`

Check for:
- Network error handling
- API error handling (401, 429, 500)
- Timeout handling
- Null/undefined safety

Expected issues to find:
- Missing timeout configuration
- No retry logic
- Generic error messages

- [ ] **Step 3: Review emotion parsing logic**

In `src/services/llm/openai.ts`, check `parseEmotion()`:
```typescript
private parseEmotion(content: string): { text: string; emotion?: string }
```

Test cases mentally:
- Input: "Hello [emotion: happy]" → Should extract "happy"
- Input: "Hello" → Should return no emotion
- Input: "[emotion: happy] Hello" → Should work (emotion at start)
- Input: "Hello [emotion: happy] World" → Should work (emotion in middle)

Action: Note if edge cases need handling

- [ ] **Step 4: Review config service localStorage usage**

Read: `src/services/config/index.ts`

Check:
- Error handling for localStorage.getItem()
- Error handling for localStorage.setItem()
- Proper JSON parsing with try-catch
- Default config merge logic

- [ ] **Step 5: Document findings**

Create: `docs/self-check-findings.md`

Template:
```markdown
# Self-Check Findings

## Service Layer Issues

### High Priority
- [ ] Issue 1: Description

### Medium Priority
- [ ] Issue 2: Description

### Low Priority
- [ ] Issue 3: Description
```

---

## Task 2: Code Review - State Management

**Files:**
- Review: `src/stores/settings.ts`
- Review: `src/stores/chat.ts`

- [ ] **Step 1: Review settings store initialization**

Read: `src/stores/settings.ts`

Check:
- Initial state loads from ConfigService
- checkConfigured() logic correct (checks apiKey && model)
- updateLLMConfig() properly merges partial config
- Race condition: What if user updates config while loading?

- [ ] **Step 2: Review chat store message flow**

Read: `src/stores/chat.ts`

Trace sendMessage() flow:
1. Creates user message
2. Adds to messages array
3. Sets isLoading = true
4. Calls llmService.chat()
5. Creates assistant message
6. Adds to messages array
7. Sets isLoading = false

Check for:
- Error state handling
- Message ID uniqueness (Date.now() collision risk?)
- Memory leak (unbounded messages array?)

- [ ] **Step 3: Check LLM service initialization**

In `chat.ts`, check `initializeLLMService()`:

Question: When is this called?
- In ChatWindow useEffect
- What if settings change after initialization?
- Should re-initialize on settings update?

Action: Note if this needs improvement

- [ ] **Step 4: Update findings document**

Add to: `docs/self-check-findings.md`

```markdown
## State Management Issues

### High Priority
- [ ] Chat store: LLM service not re-initialized on settings change

### Medium Priority
- [ ] Message ID collision risk with Date.now()

### Low Priority
- [ ] Unbounded messages array (memory leak potential)
```

---

## Task 3: Code Review - UI Components

**Files:**
- Review: `src/components/Chat/ChatWindow.tsx`
- Review: `src/components/Chat/MessageList.tsx`
- Review: `src/components/Chat/MessageItem.tsx`
- Review: `src/components/Chat/InputBar.tsx`
- Review: `src/components/Settings/APISettings.tsx`

- [ ] **Step 1: Review ChatWindow integration**

Read: `src/components/Chat/ChatWindow.tsx`

Check:
- useEffect dependency array for initializeLLMService
- Error display logic
- Component unmount cleanup

- [ ] **Step 2: Review MessageList auto-scroll**

Read: `src/components/Chat/MessageList.tsx`

Check auto-scroll logic:
```typescript
useEffect(() => {
  if (scrollRef.current) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }
}, [messages]);
```

Question: Does this work reliably?
- What if messages load slowly?
- What if user is scrolled up reading history?

- [ ] **Step 3: Review InputBar keyboard handling**

Read: `src/components/Chat/InputBar.tsx`

Check:
- Enter key sends message ✓
- Shift+Enter for newline (NOT IMPLEMENTED - using input not textarea)
- Empty message prevention ✓
- Disabled state handling ✓

Known issue: Single-line input, should be textarea

- [ ] **Step 4: Review APISettings form validation**

Read: `src/components/Settings/APISettings.tsx`

Check:
- No client-side validation before save
- No feedback if API key is invalid format
- Success message auto-dismiss (3 seconds) ✓
- Conditional Base URL rendering ✓

- [ ] **Step 5: Update findings document**

Add to: `docs/self-check-findings.md`

```markdown
## UI Component Issues

### High Priority
- [ ] InputBar: Uses <input> instead of <textarea> (no multiline support)

### Medium Priority
- [ ] MessageList: Auto-scroll interrupts user when reading history
- [ ] APISettings: No validation before save

### Low Priority
- [ ] Loading animation delay classes not defined in Tailwind config
```

---

## Task 4: Static Analysis - TypeScript Compilation

**Files:**
- Check: All TypeScript files
- Check: Type definitions

- [ ] **Step 1: Full TypeScript compilation check**

Run:
```bash
npx tsc --noEmit
```

Expected: Check for any type errors

- [ ] **Step 2: Check for `any` types**

Run:
```bash
grep -rn "any" src/ --include="*.ts" --include="*.tsx"
```

Expected: List all `any` usages

Action: Evaluate if each `any` is necessary or can be typed properly

- [ ] **Step 3: Check for missing type imports**

Review each file for:
- Unused imports
- Missing type imports
- Circular dependency risks

- [ ] **Step 4: Build production bundle**

Run:
```bash
npm run build
```

Expected: Successful build with no warnings

Check:
- Bundle size reasonable?
- No console errors during build?
- All assets included?

- [ ] **Step 5: Update findings**

Add to: `docs/self-check-findings.md`

```markdown
## TypeScript / Build Issues

### High Priority
- [ ] (List any type errors found)

### Medium Priority
- [ ] (List any warnings or `any` usages)
```

---

## Task 5: Integration Test - Configuration Workflow

**Files:**
- Test: Settings store + Config service + APISettings UI
- Test: Initial app load behavior

- [ ] **Step 1: Test initial unconfigured state**

Manual test steps:
1. Clear localStorage: `localStorage.clear()`
2. Refresh page
3. Observe behavior

Expected:
- App loads Settings tab by default
- Chat tab shows "Configure first" badge
- Warning banner visible in Settings

- [ ] **Step 2: Test OpenAI configuration**

Steps:
1. In Settings tab:
   - Provider: OpenAI
   - API Key: "test-key-openai"
   - Model: "gpt-4o-mini"
2. Click "Save Settings"

Expected:
- Success message appears
- Settings persist in localStorage
- isConfigured becomes true
- Chat tab badge disappears

Verify:
```bash
# In browser console:
localStorage.getItem('ai-girlfriend-config')
```

Should show saved config

- [ ] **Step 3: Test Deepseek configuration**

Steps:
1. Change provider to "Deepseek"
2. Base URL field appears
3. Enter Base URL: "https://api.deepseek.com"
4. Save

Expected:
- Base URL persists
- Config updates correctly

- [ ] **Step 4: Test configuration persistence across reload**

Steps:
1. Refresh page
2. Check Settings tab

Expected:
- Saved configuration loads correctly
- All fields populated
- isConfigured = true

- [ ] **Step 5: Document test results**

Add to: `docs/self-check-findings.md`

```markdown
## Integration Test Results

### Configuration Workflow
- [ ] Initial unconfigured state: PASS/FAIL
- [ ] OpenAI configuration: PASS/FAIL
- [ ] Deepseek configuration: PASS/FAIL
- [ ] Configuration persistence: PASS/FAIL

Issues found:
- (List any issues)
```

---

## Task 6: Integration Test - Chat Workflow

**Files:**
- Test: Chat store + LLM service + Chat UI
- Test: Message sending and receiving

- [ ] **Step 1: Test chat with invalid API key**

Setup:
1. Configure with invalid API key: "sk-invalid"
2. Go to Chat tab
3. Send message: "Hello"

Expected:
- Loading animation appears
- Error message appears (401 or similar)
- Error is displayed in red banner
- Input remains enabled for retry

- [ ] **Step 2: Test chat with valid API key (if available)**

Setup:
1. Configure with valid API key
2. Send message: "Hello"

Expected:
- Loading animation appears
- Assistant response appears
- Message added to list
- Auto-scroll to bottom
- Loading animation disappears

- [ ] **Step 3: Test emotion detection**

Setup:
1. Send message that might trigger emotion
2. Example: "Tell me a joke"

Expected:
- If AI includes `[emotion: happy]`, it should:
  - Remove tag from displayed text
  - Show emotion label below message

Manual check: View in console to see if emotion was parsed

- [ ] **Step 4: Test rapid message sending**

Steps:
1. Send message
2. Immediately send another before first responds

Expected behavior to verify:
- Does second message wait for first?
- Or do both send simultaneously?
- Any race conditions?

- [ ] **Step 5: Test message list with many messages**

Steps:
1. Send 20+ messages
2. Scroll behavior

Check:
- Auto-scroll works?
- Performance acceptable?
- Can scroll up to read history?

- [ ] **Step 6: Document test results**

Add to: `docs/self-check-findings.md`

```markdown
### Chat Workflow
- [ ] Invalid API key handling: PASS/FAIL
- [ ] Valid API interaction: PASS/FAIL
- [ ] Emotion detection: PASS/FAIL
- [ ] Rapid message sending: PASS/FAIL
- [ ] Many messages handling: PASS/FAIL

Issues found:
- (List any issues)
```

---

## Task 7: Integration Test - Electron App

**Files:**
- Test: Electron main process + preload
- Test: Desktop app functionality

- [ ] **Step 1: Compile Electron code**

Run:
```bash
npm run electron:compile
```

Expected:
- No TypeScript errors
- `dist-electron/main.js` created
- `dist-electron/preload.js` created

- [ ] **Step 2: Test Electron dev mode**

Run:
```bash
npm start
```

Expected:
- Dev server starts
- Electron window opens
- Shows React app
- DevTools opens automatically

Check:
- Window size correct (1200x800)?
- Title correct ("AI Girlfriend")?

- [ ] **Step 3: Test Electron + React integration**

In Electron app:
1. Test Settings configuration
2. Test Chat functionality
3. Check localStorage persists

Expected:
- All features work same as web version
- No Electron-specific errors

- [ ] **Step 4: Test window lifecycle**

Steps:
1. Close window
2. App quits (on Windows/Linux)
3. Reopen app
4. Config persists

- [ ] **Step 5: Document test results**

Add to: `docs/self-check-findings.md`

```markdown
### Electron App
- [ ] Compilation: PASS/FAIL
- [ ] Dev mode launch: PASS/FAIL
- [ ] React integration: PASS/FAIL
- [ ] Window lifecycle: PASS/FAIL

Issues found:
- (List any issues)
```

---

## Task 8: Bug Fix - Critical Issues

**Files:**
- Fix files based on findings from Tasks 1-7

- [ ] **Step 1: Review findings document**

Read: `docs/self-check-findings.md`

Priority order:
1. High priority bugs (broken functionality)
2. Medium priority bugs (UX issues)
3. Low priority bugs (nice-to-have)

- [ ] **Step 2: Fix InputBar multiline support**

If this issue was confirmed:

Modify: `src/components/Chat/InputBar.tsx`

Change from:
```tsx
<input type="text" ... />
```

To:
```tsx
<textarea 
  rows={1}
  className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 resize-none"
  style={{ minHeight: '42px', maxHeight: '200px' }}
/>
```

Update handleKeyDown to support Shift+Enter:
```typescript
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSubmit(e);
  }
  // Shift+Enter allows newline
};
```

Test:
- Enter sends message
- Shift+Enter adds newline
- Textarea auto-grows

Commit:
```bash
git add src/components/Chat/InputBar.tsx
git commit -m "fix: support multiline input with textarea and Shift+Enter"
```

- [ ] **Step 3: Fix chat store LLM service re-initialization**

If this issue was confirmed:

Modify: `src/stores/chat.ts`

Add settings subscription:
```typescript
import { useSettingsStore } from './settings';

// Inside create():
const unsubscribe = useSettingsStore.subscribe(
  (state) => state.llmConfig,
  () => {
    // Re-initialize when config changes
    get().initializeLLMService();
  }
);
```

Or simpler: Re-initialize in ChatWindow when settings change

Modify: `src/components/Chat/ChatWindow.tsx`
```typescript
const { llmConfig } = useSettingsStore();

useEffect(() => {
  initializeLLMService();
}, [llmConfig, initializeLLMService]);
```

Test: Change API settings, verify chat uses new settings

Commit:
```bash
git add src/components/Chat/ChatWindow.tsx
git commit -m "fix: re-initialize LLM service when settings change"
```

- [ ] **Step 4: Fix Tailwind animation delays**

Modify: `tailwind.config.js`

Add transitionDelay:
```javascript
module.exports = {
  theme: {
    extend: {
      transitionDelay: {
        '100': '100ms',
        '200': '200ms',
      },
    },
  },
}
```

Or update MessageList to use built-in delays:
```tsx
<div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" />
<div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:100ms]" />
<div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:200ms]" />
```

Test: Loading animation dots bounce with stagger

Commit:
```bash
git add tailwind.config.js src/components/Chat/MessageList.tsx
git commit -m "fix: add animation delays for loading indicator stagger effect"
```

- [ ] **Step 5: Add error handling improvements**

Modify: `src/stores/chat.ts`

Improve error messages:
```typescript
catch (error) {
  let errorMessage = 'Unknown error';
  
  if (error instanceof Error) {
    if (error.message.includes('401')) {
      errorMessage = 'Invalid API key. Please check your settings.';
    } else if (error.message.includes('429')) {
      errorMessage = 'Rate limit exceeded. Please wait and try again.';
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      errorMessage = 'Network error. Please check your internet connection.';
    } else {
      errorMessage = error.message;
    }
  }
  
  set({ 
    error: errorMessage,
    isLoading: false,
  });
}
```

Test: Trigger different error types, verify friendly messages

Commit:
```bash
git add src/stores/chat.ts
git commit -m "fix: improve error messages with user-friendly descriptions"
```

---

## Task 9: Bug Fix - Medium Priority Issues

**Files:**
- Fix remaining medium priority issues

- [ ] **Step 1: Add API settings validation**

Modify: `src/components/Settings/APISettings.tsx`

Add validation before save:
```typescript
const handleSave = () => {
  // Validate
  const errors: string[] = [];
  
  if (!localConfig.apiKey.trim()) {
    errors.push('API Key is required');
  }
  
  if (!localConfig.model.trim()) {
    errors.push('Model is required');
  }
  
  if ((localConfig.provider === 'deepseek' || localConfig.provider === 'custom') 
      && !localConfig.baseURL?.trim()) {
    errors.push('Base URL is required for this provider');
  }
  
  if (errors.length > 0) {
    setShowError(errors.join(', '));
    return;
  }
  
  // Save
  updateLLMConfig(localConfig);
  setShowSuccess(true);
  setTimeout(() => setShowSuccess(false), 3000);
};
```

Add error state:
```typescript
const [showError, setShowError] = useState('');
```

Add error display:
```tsx
{showError && (
  <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6">
    <p className="text-red-700">{showError}</p>
  </div>
)}
```

Test: Try saving with empty fields, verify validation

Commit:
```bash
git add src/components/Settings/APISettings.tsx
git commit -m "feat: add client-side validation for API settings"
```

- [ ] **Step 2: Fix auto-scroll interrupting user**

Modify: `src/components/Chat/MessageList.tsx`

Add scroll position tracking:
```typescript
const scrollRef = useRef<HTMLDivElement>(null);
const [isUserScrolling, setIsUserScrolling] = useState(false);

const handleScroll = () => {
  if (scrollRef.current) {
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsUserScrolling(!isAtBottom);
  }
};

useEffect(() => {
  if (scrollRef.current && !isUserScrolling) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }
}, [messages, isUserScrolling]);
```

Add onScroll handler:
```tsx
<div
  ref={scrollRef}
  onScroll={handleScroll}
  className="flex-1 overflow-y-auto p-4 space-y-2"
>
```

Test: Scroll up while receiving messages, verify no auto-scroll

Commit:
```bash
git add src/components/Chat/MessageList.tsx
git commit -m "fix: prevent auto-scroll when user is reading history"
```

- [ ] **Step 3: Fix message ID collision risk**

Modify: `src/stores/chat.ts`

Replace Date.now() with better ID generation:
```typescript
// Add at top
let messageCounter = 0;

const generateMessageId = () => {
  return `msg_${Date.now()}_${messageCounter++}`;
};

// In sendMessage:
const userMessage: Message = {
  id: generateMessageId(),
  role: 'user',
  content,
  timestamp: new Date(),
};

// ...

const assistantMessage: Message = {
  id: generateMessageId(),
  role: 'assistant',
  content: response.content,
  timestamp: new Date(),
  emotion: response.emotion,
};
```

Test: Send multiple messages rapidly, verify unique IDs

Commit:
```bash
git add src/stores/chat.ts
git commit -m "fix: improve message ID generation to prevent collisions"
```

---

## Task 10: Code Quality Improvements

**Files:**
- Improve code quality based on findings

- [ ] **Step 1: Add timeout to API calls**

Modify: `src/services/llm/openai.ts`

Add timeout configuration:
```typescript
constructor(config: LLMConfig) {
  this.config = config;
  this.client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    dangerouslyAllowBrowser: true,
    timeout: 30000, // 30 seconds
    maxRetries: 2,
  });
}
```

Test: Verify timeout works (difficult without slow API)

Commit:
```bash
git add src/services/llm/openai.ts
git commit -m "feat: add 30s timeout and 2 retries for API calls"
```

- [ ] **Step 2: Add TypeScript strict null checks**

Review files for potential null/undefined issues:
- `response.choices[0]?.message?.content` - already safe ✓
- `llmService` null check - already present ✓
- `localStorage.getItem()` - wrapped in try-catch ✓

No changes needed if already safe.

- [ ] **Step 3: Remove any `any` types if found**

If Step 4.2 found `any` usages, replace with proper types:

Example:
```typescript
// Before:
onChange={(e) => setLocalConfig({ ...localConfig, provider: e.target.value as any })}

// After:
onChange={(e) => setLocalConfig({ ...localConfig, provider: e.target.value as LLMConfig['provider'] })}
```

Commit if changes made:
```bash
git add (affected files)
git commit -m "refactor: replace any types with proper type annotations"
```

---

## Task 11: Documentation Updates

**Files:**
- Update: `docs/self-check-findings.md`
- Update: `README.md` or `README.zh-CN.md` if needed
- Create: `docs/TESTING.md`

- [ ] **Step 1: Finalize findings document**

Update: `docs/self-check-findings.md`

Add summary section:
```markdown
# Self-Check Findings Summary

**Date:** 2026-06-16  
**Phase:** Phase 1 Complete

## Summary

Total issues found: X
- Critical: X (all fixed)
- High Priority: X (Y fixed, Z remaining)
- Medium Priority: X (Y fixed, Z remaining)
- Low Priority: X (Y fixed, Z remaining)

## Test Results

### Configuration Workflow
✅ All tests passed

### Chat Workflow  
✅ All tests passed

### Electron App
✅ All tests passed

## Remaining Work

(List any unfixed issues)
```

- [ ] **Step 2: Create testing documentation**

Create: `docs/TESTING.md`

```markdown
# Testing Guide

## Manual Testing Checklist

### First-Time Setup
1. [ ] Clear localStorage
2. [ ] Refresh page
3. [ ] Verify Settings tab is active
4. [ ] Configure API settings
5. [ ] Verify configuration persists

### Chat Functionality
1. [ ] Send message
2. [ ] Verify response appears
3. [ ] Check emotion detection
4. [ ] Test multiline input
5. [ ] Test rapid messages

### Electron App
1. [ ] Run `npm start`
2. [ ] Test all features
3. [ ] Verify localStorage persists

## Known Issues

(Reference to self-check-findings.md)

## Automated Testing

TODO: Add unit tests in Phase 2
```

- [ ] **Step 3: Update README with known issues**

If significant issues remain, add section to `README.zh-CN.md`:

```markdown
## ⚠️ 已知问题

- Issue 1: Description and workaround
- Issue 2: Description and workaround
```

- [ ] **Step 4: Commit documentation**

```bash
git add docs/
git commit -m "docs: add self-check findings and testing guide"
```

---

## Task 12: Final Verification

**Files:**
- Test: Complete user workflows

- [ ] **Step 1: Fresh install test**

Simulate new user:
1. Clear localStorage
2. Clear cookies
3. Refresh page
4. Follow setup flow completely

Expected: Smooth onboarding experience

- [ ] **Step 2: Build production version**

```bash
npm run build
```

Check:
- Build succeeds
- No warnings
- Bundle size reasonable (check dist-react/)

- [ ] **Step 3: Test production build locally**

```bash
npm run preview
```

Test all functionality in production build

- [ ] **Step 4: Electron build test**

```bash
npm run electron:build
```

Check:
- Build succeeds
- Executable created in `dist/`
- (Optional) Test executable if possible

- [ ] **Step 5: Final checklist**

Review:
- [ ] All critical bugs fixed
- [ ] All tests passed
- [ ] Documentation complete
- [ ] Code committed
- [ ] Ready for user testing

---

## Self-Review Checklist

Before marking this plan complete, verify:

**Spec Coverage:**
- [x] All Phase 1 components reviewed
- [x] All workflows tested
- [x] Bug fixes planned for all critical issues

**Placeholder Check:**
- [x] All test steps have concrete actions
- [x] All expected outputs defined
- [x] No "TBD" or "TODO" without specific tasks

**Type Consistency:**
- [x] Review findings document structure consistent
- [x] Commit messages follow convention
- [x] File paths exact and complete

---

## Execution Summary

**Total Tasks:** 12  
**Estimated Time:** 4-6 hours  
**Priority:** High (blocks user testing)

**After completion:**
1. Review `docs/self-check-findings.md` for remaining issues
2. Decide if any issues block user testing
3. If ready: Proceed to user testing phase
4. If blocked: Create follow-up bug fix plan

---

**Plan Status:** Ready for execution

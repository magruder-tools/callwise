import { setTimeout as delay } from "node:timers/promises";
export const DEMO_PREP = {
  people: ["Northstar marketing director", "Finance"],
  facts: [],
  likelyQuestions: [
    {
      question: "Should we shift the budget?",
      outline:
        "Compare attribution windows and new-customer contribution first.",
      sourceIds: ["demo-brief"],
    },
  ],
  myPoints: [
    { id: "point-1", text: "Compare attribution windows" },
    { id: "point-2", text: "Separate new customers and contribution margin" },
    {
      id: "point-3",
      text: "Agree a reversible experiment and reporting owner",
    },
  ],
  watchFor: ["Avoid promising a complete turnaround in two weeks."],
  glossary: ["Northstar", "ROAS", "attribution", "contribution margin"],
};
export class DemoProvider {
  async generate({
    lane,
    transcript = [],
    question = "",
    sources = [],
    signal,
    onToken,
    onPartial,
    schema,
  }) {
    if (schema?.properties?.email) {
      return {
        whatHappened: [
          "Compared attribution windows before moving budget.",
          "Agreed to a two-week measurement diagnostic and a reversible experiment.",
        ],
        whoOwesWhat: transcript
          .filter((r) => /(?:send|share).*by (?:friday|tomorrow)/i.test(r.text))
          .map((r) => ({
            owner: r.speaker,
            what:
              r.speaker === "You"
                ? "Send the diagnostic scope"
                : "Share the channel reports",
            due: /by (friday|tomorrow)/i.exec(r.text)[0],
            segmentIds: [r.id],
          })),
        stillOpen: ["Confirm the success metric and rollback threshold."],
        email:
          "Thanks for the conversation. We will compare attribution windows, new-customer contribution and margins before changing the budget. I will send the two-week diagnostic scope by tomorrow; please share the channel reports by Friday. We can then agree an owner, success metric and rollback threshold for a small experiment.",
        interview: [],
      };
    }
    const recent = transcript
      .slice(-2)
      .map((t) => t.text)
      .join(" ")
      .toLowerCase();
    const sourceIds = sources
      .filter((s) => s.id.startsWith("demo-"))
      .slice(0, 2)
      .map((s) => s.id);
    let result;
    if (lane === "strategy")
      result = {
        kind: "bigger_picture",
        lead: "Make the first deliverable a decision finance can defend, with a small experiment and a clear rollback point.",
        points: [
          {
            label: "Scope",
            text: "Keep ongoing management separate from the diagnostic.",
          },
        ],
        covers: [],
      };
    else if (question)
      result = {
        kind: "ask",
        lead: /budget|price|cost/i.test(question)
          ? "What result would justify moving the budget, and what would make us reverse it?"
          : /attribution|report|number/i.test(question)
            ? "Could we compare the same attribution windows before deciding what these numbers mean?"
            : `On “${question.slice(0, 100)}”, what evidence and next step would help us decide?`,
        points: [
          {
            label: "Sample",
            text: "This scripted answer uses the fictional Northstar call.",
          },
        ],
        covers: [],
      };
    else if (/own|experiment worked/.test(recent))
      result = {
        kind: "ask",
        lead: "Who will own the report, and what result would make us reverse the test?",
        points: [
          {
            label: "Owner",
            text: "Name the reporting owner before changing the budget.",
          },
          {
            label: "Decision",
            text: "Agree a success metric and a rollback threshold.",
          },
        ],
        covers: ["point-3"],
      };
    else if (/two weeks|diagnostic|finance wants/.test(recent))
      result = {
        kind: "heads_up",
        lead: "In two weeks, we can give you a decision memo and a small test plan.",
        points: [
          {
            label: "Need",
            text: "Channel reports, new-customer mix and contribution margins.",
          },
          {
            label: "Scope",
            text: "A measurement diagnostic, not a promise of a turnaround.",
          },
        ],
        covers: ["point-2"],
      };
    else if (/really change|seven days|thirty days/.test(recent))
      result = {
        kind: "say",
        lead: "Different windows can change which channel looks stronger. Compare like for like before moving money.",
        points: [
          {
            label: "Window",
            text: "Search uses thirty days; social uses seven days.",
          },
          {
            label: "Proof",
            text: "Check new-customer contribution alongside the platform reports.",
          },
        ],
        covers: ["point-1"],
      };
    else
      result = {
        kind: "fact",
        lead: "The reports use different attribution windows. Compare the same revenue definition before shifting the budget.",
        points: [
          {
            label: "Search",
            text: "Thirty-day attribution window in the fictional brief.",
          },
          {
            label: "Social",
            text: "Seven-day click and one-day view attribution.",
          },
        ],
        covers: ["point-1"],
      };
    result = {
      speak: true,
      ...result,
      sourceIds: result.kind === "fact" ? sourceIds : sourceIds.slice(0, 1),
    };
    const full = result.lead;
    for (let length = 12; length < full.length; length += 12) {
      await delay(30, null, { signal });
      onToken?.();
      onPartial?.({ ...result, lead: full.slice(0, length), points: [] });
    }
    return result;
  }
}

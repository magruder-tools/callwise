import { setTimeout as delay } from "node:timers/promises";
export class DemoProvider {
  async generate({ lane, transcript, question, sources, signal }) {
    await delay(lane === "fast" ? 450 : 1300, null, { signal });
    const recent = transcript
      .slice(-3)
      .map((t) => t.text)
      .join(" ")
      .toLowerCase();
    const sourceIds = sources
      .filter((s) => s.id.startsWith("demo-"))
      .slice(0, 2)
      .map((s) => s.id);
    let card;
    if (question)
      card = {
        title: "Turn uncertainty into a clear next step",
        body: "This is a scripted demo answer. In a connected session, this card would answer your question using the current conversation and selected context.",
        say: "Could we agree on the decision, the evidence we need, and who owns the next step?",
        kind: "answer",
      };
    else if (lane === "strategy")
      card = {
        title: "Sell a decision process, then the engagement",
        body: "The immediate need is a recommendation finance can trust. Frame the diagnostic around comparable measurement, new-customer contribution, and a reversible experiment. Keep ongoing management as a separate scope.",
        say: "Let’s make the first deliverable a decision you can defend, with a small experiment and a clear rollback point.",
        kind: "strategy",
      };
    else if (/own|experiment worked/.test(recent))
      card = {
        title: "Close with an owner and a decision rule",
        body: "Agree who provides the data, who signs off, and what result would justify keeping or reversing the budget change.",
        say: "Who will own the report, and what result would make us reverse the test?",
        kind: "question",
      };
    else if (/two weeks|diagnostic|finance wants/.test(recent))
      card = {
        title: "Define the first two weeks precisely",
        body: "Offer a bounded measurement diagnostic. Ask for channel reports, new-customer mix, and contribution margins before promising a channel reallocation.",
        say: "In two weeks, we can give you a decision memo and a small test plan. Can we get those three data sets?",
        kind: "question",
      };
    else
      card = {
        title: "Check whether the ROAS figures are comparable",
        body: "The demo brief lists different attribution windows. Clarify those and separate new from returning customers before recommending a budget shift.",
        say: "Are both reports using the same attribution window and the same definition of revenue?",
        kind: "question",
      };
    return {
      cards: [
        {
          ...card,
          confidence: 0.87,
          sourceIds,
          reason: "Scripted example using the fictional Northstar meeting.",
        },
      ],
    };
  }
}

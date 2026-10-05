import test from "node:test";
import assert from "node:assert/strict";
import { correctedCategory } from "../src/index.js";

test("legacy and inferred service categories use Kirche", () => {
  assert.equal(correctedCategory({ category: "Gottesdienste", brand: "ICF Wien" }), "kirche");
  assert.equal(correctedCategory({ title: "Gottesdienst am Sonntag" }), "kirche");
  assert.equal(correctedCategory({ category: "kirche", title: "CIG Wien" }), "kirche");
});

test("category corrections preserve unrelated explicit offer categories", () => {
  assert.equal(correctedCategory({ category: "essen", title: "Burger zum Preis von einem" }), "essen");
  assert.equal(correctedCategory({ category: "gewinnspiel", title: "Gutschein gewinnen" }), "gewinnspiel");
});

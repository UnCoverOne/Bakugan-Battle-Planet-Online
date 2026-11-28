import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { validateFeedback, normalizeFeedbackMessage } from "../lib/feedback";

const validMessage = "The card effect does not match the printed text.";
test("feedback input is independent of authentication and allowlists only three fields", () => {
  const cardExists = (id: string) => id === "bb-1";
  assert.deepEqual(validateFeedback({kind:"issue",cardId:"bb-1",message:validMessage,sourceUrl:"https://private.invalid",userId:"fake",status:"resolved"},cardExists),
    {valid:true,input:{kind:"issue",cardId:"bb-1",message:validMessage}});
  assert.deepEqual(validateFeedback({kind:"suggestion",message:validMessage},cardExists),
    {valid:true,input:{kind:"suggestion",cardId:null,message:validMessage}});
  for (const payload of [null, [], {kind:"bug",message:validMessage}, {kind:"issue",message:"short"}, {kind:"issue",message:"x".repeat(2001)}, {kind:"issue",message:validMessage,cardId:"missing"}, {kind:"issue",message:validMessage,cardId:123}]) {
    assert.equal(validateFeedback(payload,cardExists).valid,false);
  }
  assert.equal(normalizeFeedbackMessage(" \u0001Hello\nworld "), "Hello\nworld");
});

test("guest feedback migration preserves historical records, review overlays and account deletion semantics", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY, display_name TEXT NOT NULL, email TEXT NOT NULL); INSERT INTO users VALUES ('u','Brawler','brawler@example.invalid'),('admin','Admin','admin@example.invalid');");
    const read = (file: string) => readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8");
    db.exec(read("0013_feedback_reports.sql"));
    db.exec(read("0014_submission_reviews.sql"));
    db.exec("INSERT INTO feedback_reports VALUES ('legacy','u','bug','bb-1','Historical message','https://legacy.invalid','reviewed',1,2); INSERT INTO submission_reviews VALUES ('bug','legacy','in_review','','admin',2);");
    const before = db.prepare("SELECT * FROM feedback_reports").get();
    db.exec(read("0023_guest_feedback.sql"));
    assert.deepEqual(db.prepare("SELECT * FROM feedback_reports").get(),before);
    assert.equal(db.prepare("SELECT status FROM submission_reviews WHERE submission_id='legacy'").get()?.status,"in_review");
    db.prepare("INSERT INTO feedback_reports(id,user_id,kind,card_id,message,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?)").run("guest",null,"issue",null,validMessage,3,3);
    const guest = db.prepare("SELECT f.user_id, COALESCE(u.display_name,'Guest') AS player_name, f.source_url, f.status FROM feedback_reports f LEFT JOIN users u ON u.id=f.user_id WHERE f.id='guest'").get();
    assert.deepEqual({...guest},{user_id:null,player_name:"Guest",source_url:"",status:"pending"});
    assert.throws(() => db.prepare("INSERT INTO feedback_reports(id,user_id,kind,message,submitted_at,updated_at) VALUES(?,?,?,?,?,?)").run("invalid","missing","issue",validMessage,4,4));
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    const indexes = db.prepare("PRAGMA index_list('feedback_reports')").all().map(row => row.name);
    assert.ok(indexes.includes("feedback_reports_user_submitted_idx"));
    assert.ok(indexes.includes("feedback_reports_status_submitted_idx"));
    db.exec("DELETE FROM users WHERE id='u'");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM feedback_reports WHERE id='legacy'").get()?.count,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM feedback_reports WHERE id='guest'").get()?.count,1);
  } finally { db.close(); }
});

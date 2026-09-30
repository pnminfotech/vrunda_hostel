const Form = require("../../models/formModels");
const { assignNextSrNoAndUpdateCounter } = require("../formController");
const { sendAdmissionSMS, bumpMessageStat } = require("../../routes/formWithDocs");

const clean = (value) => (value === undefined || value === null ? "" : String(value).trim());
const number = (value) => {
  const n = Number(String(value ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
const date = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const phone = (value) => {
  let digits = clean(value).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  return /^\d{10}$/.test(digits) ? digits : null;
};
const relationValues = new Set(["Self", "Sister", "Brother", "Father", "Husband", "Mother"]);

async function sendImportAdmissionSms(tenant) {
  try {
    const result = await sendAdmissionSMS({
      phoneNo: tenant.phoneNo, tenantName: tenant.name, roomNo: tenant.roomNo,
      bedNo: tenant.bedNo, joiningDate: tenant.joiningDate, depositAmount: tenant.depositAmount,
    });
    await bumpMessageStat("admission_sms", result);
    return result;
  } catch (error) {
    // The tenant is already saved. Record the delivery problem without marking
    // the import row as failed or creating a duplicate on retry.
    return { status: "failed", error: error.message || "Could not send admission SMS" };
  }
}

// POST /api/forms/import.  Each row is handled independently so one bad row
// never prevents the remaining tenants from being created.
async function importTenants(req, res) {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ message: "No tenant rows supplied." });
  if (rows.length > 500) return res.status(400).json({ message: "Import is limited to 500 rows at a time." });

  const created = [];
  const failed = [];
  const smsResults = [];
  const importedBeds = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const rowNumber = Number(row.__rowNumber) || index + 2;
    try {
      const name = clean(row.name);
      const phoneNo = phone(row.phoneNo);
      const depositAmount = number(row.depositAmount);
      const joiningDate = date(row.joiningDate);
      const dob = date(row.dob);
      const dateOfJoiningCollege = date(row.dateOfJoiningCollege);
      const address = clean(row.address);
      const baseRent = row.baseRent === "" || row.baseRent == null ? undefined : number(row.baseRent);
      const roomNo = clean(row.roomNo);
      const bedNo = clean(row.bedNo);
      const bedKey = `${roomNo.toLowerCase()}::${bedNo.toLowerCase()}`;
      const relative1Relation = clean(row.relative1Relation) || "Self";
      const relative2Relation = clean(row.relative2Relation) || "Self";

      const missing = [];
      if (!name) missing.push("name");
      if (!phoneNo) missing.push("10-digit phoneNo");
      if (!Number.isFinite(depositAmount) || depositAmount < 0) missing.push("non-negative depositAmount");
      if (!joiningDate) missing.push("joiningDate");
      if (!dob) missing.push("dob");
      if (!dateOfJoiningCollege) missing.push("dateOfJoiningCollege");
      if (!address) missing.push("address");
      if (!roomNo) missing.push("roomNo");
      if (!bedNo || bedNo === "__other__") missing.push("bedNo");
      if (baseRent === undefined || !Number.isFinite(baseRent) || baseRent <= 0) missing.push("positive baseRent");
      if (!relationValues.has(relative1Relation)) missing.push("valid relative1Relation");
      if (!relationValues.has(relative2Relation)) missing.push("valid relative2Relation");
      if (clean(row.relative1Phone) && !phone(row.relative1Phone)) missing.push("10-digit relative1Phone");
      if (clean(row.relative2Phone) && !phone(row.relative2Phone)) missing.push("10-digit relative2Phone");
      if (missing.length) throw new Error(`Missing or invalid: ${missing.join(", ")}`);
      if (importedBeds.has(bedKey)) throw new Error("Duplicate roomNo and bedNo in this import file");

      // Contact numbers may be shared by family members, so only a room/bed
      // assignment identifies a duplicate tenant during imports.
      const duplicate = await Form.findOne({ roomNo, bedNo })
        .select("name roomNo bedNo").lean();
      if (duplicate) {
        throw new Error(`Room ${roomNo}, bed ${bedNo} is already occupied by ${duplicate.name || "a tenant"}`);
      }

      const payload = {
        name, phoneNo: Number(phoneNo), depositAmount, joiningDate, dob,
        dateOfJoiningCollege, address,
        roomNo, bedNo, floorNo: clean(row.floorNo), category: clean(row.category),
        companyAddress: clean(row.companyAddress), tenantParents: clean(row.tenantParents),
        relativeAddress: clean(row.relativeAddress),
        leaveDate: clean(row.leaveDate) || undefined,
        relative1Relation,
        relative1Name: clean(row.relative1Name), relative1Phone: clean(row.relative1Phone),
        relative2Relation,
        relative2Name: clean(row.relative2Name), relative2Phone: clean(row.relative2Phone),
        rents: [],
      };
      payload.baseRent = baseRent;
      payload.srNo = await assignNextSrNoAndUpdateCounter();
      const tenant = await Form.create(payload);
      importedBeds.add(bedKey);
      // SMS delivery must never roll back a successfully saved tenant.
      const sms = await sendImportAdmissionSms(tenant);
      smsResults.push({ row: rowNumber, name: tenant.name, status: sms?.status || "unknown", error: sms?.error || "" });
      created.push({ row: rowNumber, id: tenant._id, name: tenant.name, srNo: tenant.srNo });
    } catch (error) {
      failed.push({ row: rowNumber, name: clean(row.name), error: error.message || "Could not import row" });
    }
  }

  return res.status(201).json({
    created, failed, createdCount: created.length, failedCount: failed.length,
    sms: smsResults,
    smsSentCount: smsResults.filter((item) => item.status === "sent").length,
    smsProblemCount: smsResults.filter((item) => item.status !== "sent").length,
  });
}

module.exports = { importTenants };

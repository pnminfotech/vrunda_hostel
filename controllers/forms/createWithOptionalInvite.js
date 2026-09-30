// // controllers/forms/createWithOptionalInvite.js
// const mongoose = require("mongoose");
// const Invite = require("../../models/Invite");
// const Form = require("../../models/formModels");

// // Re-use central SrNo helper from formController
// const {
//   assignNextSrNoAndUpdateCounter,
// } = require("../formController");

// // Always assign SrNo on server using shared helper
// async function createFormWithSrNo(rest, session) {
//   const payload = { ...rest };
//   delete payload.srNo;

//   const nextSr = await assignNextSrNoAndUpdateCounter();
//   payload.srNo = Number(nextSr);

//   if (session) {
//     const [doc] = await Form.create([payload], { session });
//     return doc;
//   }
//   return await Form.create(payload);
// }

// // Fallback flow when transactions are not supported
// const plainSingleUseFlow = async (inviteToken, rest) => {
//   const now = new Date();

//   const invite = await Invite.findOneAndUpdate(
//     { token: inviteToken, usedAt: null, expiresAt: { $gt: now } },
//     { $set: { usedAt: now } },
//     { new: true }
//   );

//   if (!invite) {
//     const e = new Error("Invalid, expired, or already used link");
//     e.http = 409;
//     throw e;
//   }

//   const doc = await createFormWithSrNo(rest, null);

//   await Invite.updateOne(
//     { _id: invite._id },
//     { $set: { usedByFormId: doc._id } }
//   );

//   return doc;
// };

// async function createWithOptionalInvite(req, res) {
//   const session = await mongoose.startSession();
//   const { inviteToken, ...rest } = req.body;

//   // No token → normal create (still uses central SrNo helper)
//   if (!inviteToken) {
//     try {
//       const saved = await createFormWithSrNo(rest, null);
//       return res.status(201).json(saved);
//     } catch (err) {
//       console.error("create form (no invite) error:", err);
//       const isDupSr =
//         err?.code === 11000 &&
//         (err?.keyPattern?.srNo || /srNo/i.test(String(err?.errmsg || "")));
//       const code = err.http || (isDupSr ? 409 : 500);
//       return res.status(code).json({
//         message: isDupSr
//           ? "Sr No already exists, please retry."
//           : err.message || "Failed to create form",
//       });
//     }
//   }

//   try {
//     let created = null;

//     try {
//       await session.withTransaction(async () => {
//         const now = new Date();

//         const invite = await Invite.findOneAndUpdate(
//           { token: inviteToken, usedAt: null, expiresAt: { $gt: now } },
//           { $set: { usedAt: now } },
//           { new: true, session }
//         );

//         if (!invite) {
//           const e = new Error("Invalid, expired, or already used link");
//           e.http = 409;
//           throw e;
//         }

//         const doc = await createFormWithSrNo(rest, session);

//         await Invite.updateOne(
//           { _id: invite._id },
//           { $set: { usedByFormId: doc._id } },
//           { session }
//         );

//         created = doc;
//       });
//     } catch (txErr) {
//       const msg = String(txErr?.message || "");
//       const noTx =
//         txErr?.code === 20 ||
//         /Transaction numbers are only allowed/i.test(msg) ||
//         /replica set/i.test(msg);

//       if (noTx) {
//         console.warn("[invites] Falling back to non-transaction flow:", msg);
//         created = await plainSingleUseFlow(inviteToken, rest);
//       } else {
//         throw txErr;
//       }
//     }

//     return res.status(201).json(created);
//   } catch (err) {
//     console.error("create (with invite) error:", err);
//     const isDupSr =
//       err?.code === 11000 &&
//       (err?.keyPattern?.srNo || /srNo/i.test(String(err?.errmsg || "")));
//     const code = err.http || (isDupSr ? 409 : 500);
//     res.status(code).json({
//       message: isDupSr
//         ? "Sr No already exists, please retry."
//         : err.message || "Failed to create form",
//     });
//   } finally {
//     session.endSession();
//   }
// }

// module.exports = { createWithOptionalInvite };



// controllers/forms/createWithOptionalInvite.js
const mongoose = require("mongoose");
const Invite = require("../../models/Invite");
const Form = require("../../models/formModels");

// Re-use central SrNo helper from formController
const {
  assignNextSrNoAndUpdateCounter,
} = require("../formController");
const { sendAdmissionSMS, bumpMessageStat } = require("../../routes/formWithDocs");

async function sendAdmissionSmsWithoutBlocking(tenant) {
  try {
    const sms = await sendAdmissionSMS({
      phoneNo: tenant.phoneNo, tenantName: tenant.name, roomNo: tenant.roomNo,
      bedNo: tenant.bedNo, joiningDate: tenant.joiningDate, depositAmount: tenant.depositAmount,
    });
    await bumpMessageStat("admission_sms", sms);
    return sms;
  } catch (error) {
    console.error("admission SMS error:", error.message || error);
    return { status: "failed", error: error.message || "Could not send admission SMS" };
  }
}

// Always assign SrNo on server using shared helper
async function createFormWithSrNo(rest, session) {
  const payload = { ...rest };
  delete payload.srNo;

  const nextSr = await assignNextSrNoAndUpdateCounter();
  payload.srNo = Number(nextSr);

  if (session) {
    const [doc] = await Form.create([payload], { session });
    return doc;
  }
  return await Form.create(payload);
}

// Fallback flow when transactions are not supported
const plainSingleUseFlow = async (inviteToken, rest) => {
  const now = new Date();

  const invite = await Invite.findOneAndUpdate(
    { token: inviteToken, usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { new: true }
  );

  if (!invite) {
    const e = new Error("Invalid, expired, or already used link");
    e.http = 409;
    throw e;
  }

  const doc = await createFormWithSrNo(rest, null);

  await Invite.updateOne(
    { _id: invite._id },
    { $set: { usedByFormId: doc._id } }
  );

  return doc;
};

async function createWithOptionalInvite(req, res) {
  const session = await mongoose.startSession();
  const { inviteToken, ...rest } = req.body;

  /* ---------------------------------------------------------
     ✅ FIX 1: STORE monthly rent into baseRent (BEFORE deleting)
     --------------------------------------------------------- */
  const monthlyRent = Number(rest.rentAmount ?? rest.baseRent ?? 0);
  if (Number.isFinite(monthlyRent) && monthlyRent > 0) {
    rest.baseRent = monthlyRent; // ✅ monthly expected rent stored on tenant
  }

  /* ---------------------------------------------------------
     ✅ FIX 2: rents[] means "payments", so always start empty
     --------------------------------------------------------- */
  delete rest.rents;
  delete rest.rentAmount;
  delete rest.month;
  delete rest.date;
  delete rest.paymentMode;
  rest.rents = []; // 🟢 Force rents to always start empty

  // No invite token → normal create
  if (!inviteToken) {
    try {
      const saved = await createFormWithSrNo(rest, null);
      const admissionSms = await sendAdmissionSmsWithoutBlocking(saved);
      return res.status(201).json({ ...saved.toObject(), admissionSms });
    } catch (err) {
      console.error("create form (no invite) error:", err);
      const isDupSr =
        err?.code === 11000 &&
        (err?.keyPattern?.srNo || /srNo/i.test(String(err?.errmsg || "")));
      const code = err.http || (isDupSr ? 409 : 500);
      return res.status(code).json({
        message: isDupSr
          ? "Sr No already exists, please retry."
          : err.message || "Failed to create form",
      });
    }
  }

  // Invite token exists → special flow
  try {
    let created = null;

    try {
      await session.withTransaction(async () => {
        const now = new Date();

        const invite = await Invite.findOneAndUpdate(
          { token: inviteToken, usedAt: null, expiresAt: { $gt: now } },
          { $set: { usedAt: now } },
          { new: true, session }
        );

        if (!invite) {
          const e = new Error("Invalid, expired, or already used link");
          e.http = 409;
          throw e;
        }

        // 🟢 rents already sanitized above
        const doc = await createFormWithSrNo(rest, session);

        await Invite.updateOne(
          { _id: invite._id },
          { $set: { usedByFormId: doc._id } },
          { session }
        );

        created = doc;
      });
    } catch (txErr) {
      const msg = String(txErr?.message || "");
      const noTx =
        txErr?.code === 20 ||
        /Transaction numbers are only allowed/i.test(msg) ||
        /replica set/i.test(msg);

      if (noTx) {
        console.warn("[invites] Falling back to non-transaction flow:", msg);
        created = await plainSingleUseFlow(inviteToken, rest);
      } else {
        throw txErr;
      }
    }

    const admissionSms = await sendAdmissionSmsWithoutBlocking(created);
    return res.status(201).json({ ...created.toObject(), admissionSms });
  } catch (err) {
    console.error("create (with invite) error:", err);
    const isDupSr =
      err?.code === 11000 &&
      (err?.keyPattern?.srNo || /srNo/i.test(String(err?.errmsg || "")));
    const code = err.http || (isDupSr ? 409 : 500);
    res.status(code).json({
      message: isDupSr
        ? "Sr No already exists, please retry."
        : err.message || "Failed to create form",
    });
  } finally {
    session.endSession();
  }
}

module.exports = { createWithOptionalInvite };

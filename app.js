require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql");
const session = require("express-session");
const NodeCache = require("node-cache");
const accountSid = process.env.TWILIO_accountSid;
const authToken = process.env.TWILIO_authToken;
const client = require("twilio")(accountSid, authToken);

const app = express();
const port = 3000;

app.use(cors({ credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: "testSecretKeyToBeReplacedLater",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Set it to true if you are using HTTPS
      httpOnly: true,
      maxAge: 2 * 24 * 60 * 60 * 1000, // Session expiry time (in milliseconds)
    },
  })
);

// Create a MySQL connection pool
const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "hbstudent",
  password: process.env.DB_PASSWORD || "hbstudent",
  database: process.env.DB_NAME || "referral",
});

const otpCache = new NodeCache();

// API endpoint to send OTP
app.post("/api/sendOtp", (req, res) => {
  const { phoneNumber } = req.body;

  // Check if the user exists in the database
  pool.query(
    "SELECT * FROM users WHERE phoneNumber = ?",
    [phoneNumber],
    (error, results) => {
      if (error) {
        console.error("Error while checking user existence:", error);
        res.status(500).json({
          success: false,
          errorMsg: "Internal server error",
          error: error,
        });
      } else {
        // Generate OTP
        const otp = ("" + Math.random()).substring(2, 8);

        // Store the OTP in the session
        req.session.phoneNumber = phoneNumber;
        // req.session.otp = otp;
        otpCache.set(phoneNumber, otp, 300);
        console.log("OTP:" + otp);

        client.messages
          .create({
            body: `Your BytesCare Hunt code is ${otp}.`,
            from: "whatsapp:+14155238886",
            to: "whatsapp:" + phoneNumber,
          })
          .then((message) => console.log(JSON.stringify(message)));
        //Implement logic to send otp
        if (results.length > 0) {
          res.status(200).json({ success: true, userExists: true });
        } else {
          res.status(404).json({ success: true, userExists: false });
        }
      }
    }
  );
});

// API endpoint to verify OTP and create a new user
app.post("/api/login", (req, res) => {
  const { phoneNumber, otp } = req.body;

  // Retrieve the stored OTP from the session
  const storedOtp = otpCache.get(phoneNumber);

  if (storedOtp && otp === storedOtp) {
    // OTP is valid, login current user.
    pool.query(
      "SELECT * FROM users WHERE phoneNumber = ?",
      [phoneNumber],
      (err, results) => {
        if (err) {
          return res.status(500).json({
            success: false,
            errorMsg: "Internal server error",
            error: err,
          });
        } else {
          req.session.user = results[0];
          req.session.isAuthenticated = true;
          otpCache.del(phoneNumber);

          console.log(req.session);

          res.status(200).json({ success: true, user: results[0] });
        }
      }
    );
  } else {
    res.status(401).json({ success: false, errorMsg: "Invalid OTP" });
  }
});

app.post("/api/signup", async (req, res) => {
  const { phoneNumber, otp, referredBy, Name } = req.body;

  // Retrieve the stored OTP from the session
  const storedOtp = otpCache.get(phoneNumber);

  if (storedOtp && otp === storedOtp) {
    if (referredBy != null) {
      const referralExists = await checkReferralExists(referredBy);

      if (!referralExists) {
        return res
          .status(401)
          .json({ success: false, errorMsg: "Incorrect Referral Code" });
      }
    }

    referralCode = await generateUniqueReferralCode();

    const user = {
      name: Name,
      phoneNumber: phoneNumber,
      referredBy: referredBy,
      uuid: referralCode,
    };

    pool.query("INSERT INTO users SET ?", user, (err, results) => {
      if (err) {
        console.error("Error during signup:", err);
        return res.status(500).json({
          success: false,
          errorMsg: "Internal Server Error",
          error: err,
        });
      } else {
        req.session.user = user;
        req.session.isAuthenticated = true;
        otpCache.del(phoneNumber);

        console.log(req.session);

        res.status(200).json({ success: true, user: user });
      }
    });
  } else {
    res.status(401).json({ success: false, errorMsg: "Invalid OTP" });
  }
});

app.post("/api/receiveMessage", (req, res) => {
  console.log(JSON.stringify(req));
  res.status(200);
});

app.get("/api/auth/status", (req, res) => {
  console.log(req.session);
  const isAuthenticated = req.session.isAuthenticated || false;
  console.log(isAuthenticated);
  res.status(200).json({ isAuthenticated });
});

app.get("/api/logout", (req, res) => {
  req.session.isAuthenticated = false;
  req.session.destroy((err) => {
    if (err) {
      console.error("Error while logging out:", err);
      res.status(500).json({
        success: false,
        errorMsg: "Internal server error",
        error: err,
      });
    } else {
      console.log("success");
      res.status(200).json({ success: true });
    }
  });
  console.log(req.session);
});

async function generateUniqueReferralCode() {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let referralCode = "";

  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    referralCode += characters.charAt(randomIndex);
  }

  const referralExists = await checkReferralExists(referralCode);

  if (referralExists) {
    return generateUniqueReferralCode();
  }

  console.log(referralCode);
  return referralCode;
}

async function checkReferralExists(referralCode) {
  const results = await executeQuery(
    "SELECT phoneNumber FROM users WHERE uuid = ?",
    [referralCode]
  );

  return results.length > 0;
}

function executeQuery(query, params) {
  return new Promise((resolve, reject) => {
    pool.query(query, params, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

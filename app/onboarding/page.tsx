"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Onboarding() {
  const [role, setRole] = useState("");
  const [form, setForm] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // ✅ Get role
  useEffect(() => {
    const getRole = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data, error } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .single();

      if (error) {
        console.error("Role fetch error:", error);
      }

      setRole(data?.role);
    };

    getRole();
  }, []);

  // ✅ Submit
  const handleSubmit = async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      return;
    }

    // 🔹 Update users table
    const { error: userError } = await supabase
      .from("users")
      .update({
        first_name: form.first_name,
        last_name: form.last_name,
      })
      .eq("id", user.id);

    if (userError) {
      console.error("User update error:", userError);
    }

    // 🔹 Update role table
    if (role === "doctor") {
      const { data, error } = await supabase
        .from("doctors")
        .update({
          education: form.education,
          specialization: form.specialization,
          experience: Number(form.experience),
        })
        .eq("id", user.id)
        .select();

      console.log("Doctor update:", data, error);
    } else if (role === "patient") {
      const { data, error } = await supabase
        .from("patients")
        .update({
          age: Number(form.age),
          disease: form.disease,
          gender: form.gender,
        })
        .eq("id", user.id)
        .select();

      console.log("Patient update:", data, error);
    }

    setLoading(false);
    router.push("/");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <Card className="w-full max-w-md shadow-xl rounded-2xl">
        <CardHeader>
          <CardTitle className="text-center text-2xl font-semibold">
            Complete Your Profile
          </CardTitle>
          <p className="text-center text-sm text-muted-foreground">
            Please fill in your details to continue
          </p>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* FIRST NAME */}
          <div className="space-y-2">
            <label className="text-sm font-medium">First Name</label>
            <Input
              placeholder="Enter your first name"
              onChange={(e) =>
                setForm({ ...form, first_name: e.target.value })
              }
            />
          </div>

          {/* LAST NAME */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Last Name</label>
            <Input
              placeholder="Enter your last name"
              onChange={(e) =>
                setForm({ ...form, last_name: e.target.value })
              }
            />
          </div>

          {/* DOCTOR FORM */}
          {role === "doctor" && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Education</label>
                <Input
                  placeholder="e.g. MBBS, FCPS"
                  onChange={(e) =>
                    setForm({ ...form, education: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Specialization</label>
                <Input
                  placeholder="e.g. Physiotherapy"
                  onChange={(e) =>
                    setForm({ ...form, specialization: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Experience</label>
                <Input
                  type="number"
                  placeholder="Years of experience"
                  onChange={(e) =>
                    setForm({ ...form, experience: e.target.value })
                  }
                />
              </div>
            </>
          )}

          {/* PATIENT FORM */}
          {role === "patient" && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Age</label>
                <Input
                  type="number"
                  placeholder="Enter your age"
                  onChange={(e) =>
                    setForm({ ...form, age: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Disease / Problem</label>
                <Input
                  placeholder="Describe your issue"
                  onChange={(e) =>
                    setForm({ ...form, disease: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Gender</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  onChange={(e) =>
                    setForm({ ...form, gender: e.target.value })
                  }
                >
                  <option value="">Select Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </>
          )}

          {!role && (
            <p className="text-center text-sm text-muted-foreground">
              Loading...
            </p>
          )}

          {/* BUTTON */}
          <Button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full rounded-xl"
          >
            {loading ? "Saving..." : "Continue"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
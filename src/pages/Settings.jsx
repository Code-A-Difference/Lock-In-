const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogOut, User, Palette, Trash2, Loader2, Users, UserPlus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import UserNotRegisteredError from '../components/UserNotRegisteredError';
import { Badge } from "@/components/ui/badge";
import FriendsSection from '../components/settings/FriendsSection';

const THEME_COLORS = [
  { name: 'Indigo', value: 'indigo' },
  { name: 'Rose', value: 'rose' },
  { name: 'Emerald', value: 'emerald' },
  { name: 'Amber', value: 'amber' },
  { name: 'Cyan', value: 'cyan' },
  { name: 'Purple', value: 'purple' },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState('profile');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const [themeColor, setThemeColor] = useState('indigo');

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await db.auth.me();
        setUser(userData);
        setFullName(userData.full_name || '');
        setUsername(userData.username || '');
        setDarkMode(userData.dark_mode || false);
        setThemeColor(userData.theme_color || 'indigo');
      } catch (error) {
        console.error('Error fetching user:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const updateProfileMutation = useMutation({
    mutationFn: (data) => db.auth.updateMe(data),
    onSuccess: async () => {
      const updatedUser = await db.auth.me();
      setUser(updatedUser);
      setFullName(updatedUser.full_name || '');
      setUsername(updatedUser.username || '');
      alert('Profile updated successfully!');
    }
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      await db.entities.User.delete(user.id);
      db.auth.logout();
    }
  });

  const handleUpdateProfile = async () => {
    const updates = { full_name: fullName };
    if (username) updates.username = username;
    await updateProfileMutation.mutateAsync(updates);
  };

  const handleUpdateTheme = (field, value) => {
    const updates = { [field]: value };
    if (field === 'dark_mode') setDarkMode(value);
    if (field === 'theme_color') setThemeColor(value);
    updateProfileMutation.mutate(updates);
  };

  const handleSignOut = () => {
    db.auth.logout();
  };

  const handleDeleteAccount = () => {
    if (window.confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
      deleteAccountMutation.mutate();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!user) {
    return <UserNotRegisteredError />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-slate-800 p-4 pb-24 md:pb-4">
      <div className="max-w-3xl mx-auto pt-6">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-6">Settings</h1>
        
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="profile">Profile & Account</TabsTrigger>
            <TabsTrigger value="friends">Friends</TabsTrigger>
          </TabsList>
          
          <TabsContent value="profile" className="space-y-6">
          {/* Profile Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Profile
              </CardTitle>
              <CardDescription>Manage your personal information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={user.email} disabled className="bg-slate-50" />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a username"
                />
              </div>
              
              <Button
                onClick={handleUpdateProfile}
                disabled={updateProfileMutation.isPending}
                className="bg-indigo-500 hover:bg-indigo-600"
              >
                {updateProfileMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Appearance Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="w-5 h-5" />
                Appearance
              </CardTitle>
              <CardDescription>Customize how the app looks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="darkMode" className="text-base">Dark Mode</Label>
                  <p className="text-sm text-slate-500">Toggle dark theme</p>
                </div>
                <Switch
                  id="darkMode"
                  checked={darkMode}
                  onCheckedChange={(checked) => handleUpdateTheme('dark_mode', checked)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="themeColor">Theme Color</Label>
                <Select value={themeColor} onValueChange={(value) => handleUpdateTheme('theme_color', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a color" />
                  </SelectTrigger>
                  <SelectContent>
                    {THEME_COLORS.map((color) => (
                      <SelectItem key={color.value} value={color.value}>
                        {color.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Account Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Account Actions</CardTitle>
              <CardDescription>Manage your account</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                onClick={handleSignOut}
                variant="outline"
                className="w-full justify-start"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
              
              <Button
                onClick={handleDeleteAccount}
                variant="destructive"
                className="w-full justify-start"
                disabled={deleteAccountMutation.isPending}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Account
              </Button>
            </CardContent>
          </Card>
          </TabsContent>
          
          <TabsContent value="friends">
            <FriendsSection user={user} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
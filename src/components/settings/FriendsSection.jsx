const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Check, X, Users } from "lucide-react";

export default function FriendsSection({ user }) {
  const [searchInput, setSearchInput] = useState('');
  const queryClient = useQueryClient();

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => db.entities.User.list()
  });

  const { data: friendRequests = [] } = useQuery({
    queryKey: ['friends'],
    queryFn: () => db.entities.Friend.list()
  });

  const myFriends = friendRequests.filter(f => 
    (f.requester_email === user?.email || f.recipient_email === user?.email) && 
    f.status === 'accepted'
  );

  const pendingRequests = friendRequests.filter(f => 
    f.recipient_email === user?.email && f.status === 'pending'
  );

  const sendRequestMutation = useMutation({
    mutationFn: async (emailOrUsername) => {
      const targetUser = allUsers.find(u => 
        u.email === emailOrUsername || u.username === emailOrUsername
      );
      
      if (!targetUser) throw new Error('User not found');
      if (targetUser.email === user.email) throw new Error('Cannot add yourself');
      
      const existing = friendRequests.find(f =>
        (f.requester_email === user.email && f.recipient_email === targetUser.email) ||
        (f.requester_email === targetUser.email && f.recipient_email === user.email)
      );
      
      if (existing) throw new Error('Friend request already exists');
      
      return db.entities.Friend.create({
        requester_email: user.email,
        recipient_email: targetUser.email
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['friends']);
      setSearchInput('');
    },
    onError: (error) => alert(error.message)
  });

  const acceptRequestMutation = useMutation({
    mutationFn: (id) => db.entities.Friend.update(id, { status: 'accepted' }),
    onSuccess: () => queryClient.invalidateQueries(['friends'])
  });

  const deleteFriendMutation = useMutation({
    mutationFn: (id) => db.entities.Friend.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['friends'])
  });

  const getFriendEmail = (friend) => {
    return friend.requester_email === user?.email ? friend.recipient_email : friend.requester_email;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Add Friend
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Enter email or username"
            />
            <Button onClick={() => sendRequestMutation.mutate(searchInput)}>
              Send Request
            </Button>
          </div>
        </CardContent>
      </Card>

      {pendingRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingRequests.map(req => (
              <div key={req.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <span className="text-sm font-medium">{req.requester_email}</span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => acceptRequestMutation.mutate(req.id)}>
                    <Check className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteFriendMutation.mutate(req.id)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            My Friends ({myFriends.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {myFriends.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No friends yet</p>
          ) : (
            myFriends.map(friend => (
              <div key={friend.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <span className="text-sm font-medium">{getFriendEmail(friend)}</span>
                <Button size="sm" variant="ghost" onClick={() => deleteFriendMutation.mutate(friend.id)}>
                  Remove
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}